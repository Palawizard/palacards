import { and, asc, eq, inArray, isNull, lt, schema, sql } from "@palacards/db";
import {
  BOSS_ANSWER_GRACE_MS,
  BOSS_ASSAULTS_PER_DAY,
  BOSS_CARDS_PER_ASSAULT,
  BOSS_HP_WINDOW_DAYS,
  BOSS_QUESTION_MS,
  BOSS_REWARDS,
  bossDamage,
  bossHit,
  bossMaxHp,
  cardHiddenUntilAnswer,
  effectiveStats,
  parisDay,
  seededRandom,
  type BossHit,
  type Question,
  type QuestionType,
} from "@palacards/game";
import type { BossAssaultDTO, BossDTO, BossHitDTO, BossLiveDTO, BossQuestionDTO, CardDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { instancesByIds } from "./cards.js";
import { afterCommit, Effects } from "./notifications.js";
import { activeSeason, lockPlayers, logMovement, movePw, packState, pushWallet, type Player } from "./players.js";
import { emit } from "./progression.js";
import { QUESTION_PREP_MS, quizQuestion, withTimeout } from "./quiz.js";
import { nextParisMidnight } from "./wheel.js";
import { articleUrl } from "./wiki.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type BossDay = typeof schema.bossDays.$inferSelect;
type Assault = typeof schema.bossAssaults.$inferSelect;
type Hit = typeof schema.bossHits.$inferSelect;

export const BOSS_FINALIZE_JOB = "boss-finalize";

const ba = schema.bossAssaults;
const bh = schema.bossHits;

/**
 * Boss du jour : une Légendaire de la saison, tirée d'après le jour, créée à la première demande.
 * Ses PV sont partagés par tous les joueurs, et fixés à sa création d'après les assaillants des derniers jours.
 */
export async function bossOfDay(ctx: Ctx, day = parisDay(ctx.now())): Promise<BossDay> {
  const [existing] = await ctx.db.select().from(schema.bossDays).where(eq(schema.bossDays.day, day));
  if (existing) return existing;
  const season = await activeSeason(ctx.db);
  const key = seededRandom(`boss:${day}`)();
  let [row] = await ctx.db.execute<{ id: string }>(sql`
    select id from cards where season = ${season} and rarity = 'L' and rand_key >= ${key} order by rand_key limit 1
  `);
  if (!row)
    [row] = await ctx.db.execute<{ id: string }>(
      sql`select id from cards where season = ${season} and rarity = 'L' order by rand_key limit 1`,
    );
  if (!row) throw conflict("no_boss", "Aucune Légendaire dans la saison : pas de boss aujourd'hui.");
  const maxHp = bossMaxHp(await dailyAssailants(ctx, day));
  await ctx.db
    .insert(schema.bossDays)
    .values({ day, cardId: Number(row.id), season, maxHp, hp: maxHp })
    .onConflictDoNothing();
  const [boss] = await ctx.db.select().from(schema.bossDays).where(eq(schema.bossDays.day, day));
  void ctx.wiki.load([{ cardId: boss!.cardId, title: (await ctx.wiki.titleOf(boss!.cardId)) ?? "" }]).catch(() => {});
  return boss!;
}

/** Assaillants par jour, en moyenne sur les derniers jours où quelqu'un a attaqué (0 sans historique). */
async function dailyAssailants(ctx: Ctx, day: string): Promise<number> {
  const [row] = await ctx.db.execute<{ avg: number | null }>(sql`
    select avg(n)::float as avg from (
      select count(distinct user_id) as n from boss_assaults
      where day < ${day}::date and day >= ${day}::date - ${BOSS_HP_WINDOW_DAYS}::int
      group by day
    ) t
  `);
  return Number(row?.avg ?? 0);
}

async function bossCard(ctx: Ctx, boss: BossDay): Promise<{ card: CardDTO; extract: string | null }> {
  const [row] = await ctx.db.execute<{
    title: string;
    atk: number;
    def: number;
    thumb_url: string | null;
    page_url: string | null;
    extract: string | null;
  }>(sql`
    select c.title, c.atk, c.def, s.thumb_url, s.page_url, s.extract from cards c
    left join wiki_summaries s on s.page_id = c.id
    where c.season = ${boss.season} and c.id = ${boss.cardId}
  `);
  return {
    card: {
      instanceId: null,
      cardId: boss.cardId,
      season: boss.season,
      title: row?.title ?? "?",
      rarity: "L",
      atk: row?.atk ?? 0,
      def: row?.def ?? 0,
      level: 1,
      thumbUrl: row?.thumb_url ?? null,
      pageUrl: row?.page_url ?? articleUrl(row?.title ?? ""),
    },
    extract: row?.extract ?? null,
  };
}

// ---------------------------------------------------------------------------
// Questions (préparées à l'avance, figées en base au moment où elles sont posées)
// ---------------------------------------------------------------------------

const preparing = new Map<string, Promise<Question>>();

function questionFor(ctx: Ctx, assault: Assault, hit: Hit, hits: Hit[]): Promise<Question> {
  const key = `${assault.id}:${hit.idx}`;
  let p = preparing.get(key);
  if (!p) {
    const avoid = hits.map((h) => (h.question as Question | null)?.type).filter((t): t is QuestionType => !!t);
    // Le joueur a choisi ses cinq cartes : les leurres des questions de reconnaissance sont les quatre autres,
    // sinon il reconnaîtrait la sienne parmi des inconnues.
    p = quizQuestion(ctx, {
      seed: `boss:${assault.day}:${assault.id}:${hit.idx}`,
      cardId: hit.cardId,
      season: hit.season,
      rarity: hit.rarity,
      avoid,
      known: hits.filter((h) => h.idx !== hit.idx).map((h) => h.cardId),
    });
    preparing.set(key, p);
    void p.catch(() => {}).finally(() => setTimeout(() => preparing.delete(key), 60_000).unref?.());
  }
  return p;
}

async function hitsOf(db: Ctx["db"] | Tx, assaultId: number): Promise<Hit[]> {
  return db.select().from(bh).where(eq(bh.assaultId, assaultId)).orderBy(asc(bh.idx));
}

/** Prépare en arrière-plan la question suivante d'un assaut (résumés Wikipédia des leurres). */
function prefetchNext(ctx: Ctx, assault: Assault, hits: Hit[]) {
  const next = hits.find((h) => !h.servedAt);
  if (!next) return;
  void questionFor(ctx, assault, next, hits).catch(() => {});
}

// ---------------------------------------------------------------------------
// Assauts
// ---------------------------------------------------------------------------

/** Démarre un assaut : 5 cartes de sa collection (copiées telles quelles : ATK au niveau actuel). */
export async function startAssault(ctx: Ctx, userId: string, instanceIds: number[]) {
  const ids = [...new Set(instanceIds)];
  if (ids.length !== BOSS_CARDS_PER_ASSAULT)
    throw badRequest("boss_cards", `Choisis ${BOSS_CARDS_PER_ASSAULT} cartes différentes.`);
  const boss = await bossOfDay(ctx);
  const assault = await ctx.db.transaction(async (tx) => {
    await lockPlayers(tx, [userId]);
    const mine = await tx
      .select()
      .from(ba)
      .where(and(eq(ba.day, boss.day), eq(ba.userId, userId)));
    if (mine.some((a) => !a.finishedAt)) throw conflict("assault_running", "Termine d'abord ton assaut en cours.");
    if (mine.length >= BOSS_ASSAULTS_PER_DAY)
      throw conflict("no_assault_left", "Plus d'assaut aujourd'hui : le boss t'attend demain.");
    const cards = await tx
      .select()
      .from(schema.cardInstances)
      .where(and(inArray(schema.cardInstances.id, ids), eq(schema.cardInstances.ownerId, userId)));
    if (cards.length !== ids.length) throw notFound("Certaines cartes ne sont plus dans ta collection.");
    const [created] = await tx
      .insert(ba)
      .values({ day: boss.day, userId, number: mine.length + 1, startedAt: ctx.now() })
      .returning();
    const byId = new Map(cards.map((c) => [c.id, c]));
    await tx.insert(bh).values(
      ids.map((id, idx) => {
        const c = byId.get(id)!;
        return {
          assaultId: created!.id,
          idx,
          instanceId: c.id,
          cardId: c.cardId,
          season: c.season,
          rarity: c.rarity,
          atk: effectiveStats(c.atk, c.def, c.level).atk,
        };
      }),
    );
    return created!;
  });
  prefetchNext(ctx, assault, await hitsOf(ctx.db, assault.id));
  return serveNext(ctx, userId, assault.id);
}

async function lockAssault(tx: Tx, userId: string, assaultId: number): Promise<Assault> {
  const [a] = await tx
    .select()
    .from(ba)
    .where(and(eq(ba.id, assaultId), eq(ba.userId, userId)))
    .for("update");
  if (!a) throw notFound("Assaut introuvable.");
  return a;
}

/** Pose la question suivante de l'assaut (ou le termine après la cinquième). */
export async function serveNext(ctx: Ctx, userId: string, assaultId: number) {
  const [assault] = await ctx.db
    .select()
    .from(ba)
    .where(and(eq(ba.id, assaultId), eq(ba.userId, userId)));
  if (!assault) throw notFound("Assaut introuvable.");
  let hits = await hitsOf(ctx.db, assaultId);
  // Une question posée et restée sans réponse au-delà du chrono est ratée.
  await expireOpenQuestion(ctx, userId, assault, hits);
  hits = await hitsOf(ctx.db, assaultId);
  const open = hits.find((h) => h.servedAt && !h.answeredAt);
  const next = hits.find((h) => !h.servedAt);
  if (!open && next && !assault.finishedAt) {
    // Préparation trop longue (Wikipédia lent) : on repart de ce qui est en cache.
    const question =
      (await withTimeout(questionFor(ctx, assault, next, hits), QUESTION_PREP_MS + 2_000, null)) ??
      (await questionFor(ctx, { ...assault, id: -assault.id }, next, hits));
    await ctx.db
      .update(bh)
      .set({ question, servedAt: ctx.now() })
      .where(and(eq(bh.assaultId, assaultId), eq(bh.idx, next.idx), isNull(bh.servedAt)));
    prefetchNext(ctx, assault, await hitsOf(ctx.db, assaultId));
  } else if (!open && !next && !assault.finishedAt) {
    await finishAssault(ctx, userId, assaultId);
  }
  return bossState(ctx, userId);
}

/** Question posée, chrono (et marge) dépassé : réponse absente, aucun dégât. */
async function expireOpenQuestion(ctx: Ctx, userId: string, assault: Assault, hits: Hit[]) {
  const open = hits.find((h) => h.servedAt && !h.answeredAt);
  if (!open) return;
  const elapsed = ctx.now().getTime() - open.servedAt!.getTime();
  if (elapsed <= BOSS_QUESTION_MS + BOSS_ANSWER_GRACE_MS) return;
  await resolveHit(ctx, userId, assault.id, open.idx, null);
}

/** Répond à la question en cours de l'assaut. */
export async function answerBoss(ctx: Ctx, userId: string, assaultId: number, idx: number, choice: number) {
  await resolveHit(ctx, userId, assaultId, idx, choice);
  return bossState(ctx, userId);
}

/**
 * Résout une question : temps mesuré par le serveur, dégâts selon l'ATK de la carte (critique sous 4 s).
 * Une transaction : boss verrouillé d'abord (puis les joueurs à récompenser, toujours dans cet ordre),
 * PV retirés ; le coup fatal paie tous les participants du jour.
 */
async function resolveHit(ctx: Ctx, userId: string, assaultId: number, idx: number, choice: number | null) {
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const [peek] = await tx.select({ day: ba.day }).from(ba).where(eq(ba.id, assaultId));
    if (!peek) throw notFound("Assaut introuvable.");
    const [boss] = await tx.select().from(schema.bossDays).where(eq(schema.bossDays.day, peek.day)).for("update");
    const assault = await lockAssault(tx, userId, assaultId);
    if (assault.finishedAt) throw conflict("assault_over", "Cet assaut est terminé.");
    const [hit] = await tx
      .select()
      .from(bh)
      .where(and(eq(bh.assaultId, assaultId), eq(bh.idx, idx)));
    if (!hit?.servedAt || !hit.question) throw conflict("no_question", "Aucune question en cours.");
    if (hit.answeredAt) throw conflict("already_answered", "Tu as déjà répondu à cette question.");
    const now = ctx.now();
    const elapsed = now.getTime() - hit.servedAt.getTime();
    const late = elapsed > BOSS_QUESTION_MS + BOSS_ANSWER_GRACE_MS;
    const question = hit.question as Question;
    const valid = choice !== null && !late && choice >= 0 && choice < question.choices.length;
    const correct = valid && choice === question.answer;
    const answerMs = valid ? Math.min(elapsed, BOSS_QUESTION_MS) : null;
    const kind: BossHit = bossHit(correct, answerMs);
    const damage = bossDamage(hit.atk, kind);
    await tx
      .update(bh)
      .set({ answeredAt: now, choice: valid ? choice : null, correct, answerMs, damage })
      .where(and(eq(bh.assaultId, assaultId), eq(bh.idx, idx)));
    await tx
      .update(ba)
      .set({ damage: assault.damage + damage })
      .where(eq(ba.id, assaultId));

    let killed: Player[] | null = null;
    const hp = Math.max(0, boss!.hp - damage);
    if (boss && damage > 0 && boss.hp > 0) {
      await tx
        .update(schema.bossDays)
        .set({ hp, ...(hp === 0 ? { killedAt: now, killedBy: userId } : {}) })
        .where(eq(schema.bossDays.day, boss.day));
      if (hp === 0) killed = await payKill(tx, boss, userId, now, fx);
    }
    return {
      boss: boss!,
      hp: boss!.hp > 0 ? hp : 0,
      damage,
      kind,
      killed,
      killedAt: hp === 0 && boss!.hp > 0 ? now : boss!.killedAt,
    };
  });
  const [u] = await ctx.db.execute<{ name: string }>(
    sql`select coalesce(display_username, name) as name from "user" where id = ${userId}`,
  );
  await afterCommit(ctx, async () => {
    const live: BossLiveDTO = {
      day: res.boss.day,
      hp: res.hp,
      maxHp: res.boss.maxHp,
      killedAt: res.killedAt?.toISOString() ?? null,
      last: { name: u?.name ?? "?", damage: res.damage, hit: res.kind },
    };
    ctx.rt.toAll("boss:update", live);
    if (res.killed) {
      pushPaid(ctx, res.killed);
      for (const p of res.killed) void emit(ctx, p.userId, { type: "boss_killed", lastHit: p.userId === userId });
    }
    await fx.flush(ctx);
  });
}

/**
 * Coup fatal : chaque joueur ayant lancé un assaut aujourd'hui reçoit la récompense (PW et paquets bonus).
 * Le paquet du meilleur assaillant attend minuit : les renforts peuvent encore le lui prendre.
 */
async function payKill(tx: Tx, boss: BossDay, killerId: string, now: Date, fx: Effects) {
  const rows = await tx.execute<{ user_id: string }>(
    sql`select distinct user_id from boss_assaults where day = ${boss.day}`,
  );
  return payKillReward(
    tx,
    boss,
    rows.map((r) => r.user_id),
    { killerId, late: false, now },
    fx,
  );
}

/**
 * Verse la récompense de chute aux joueurs qui ne l'ont pas encore touchée ce jour-là (une ligne
 * `boss_rewards` par joueur et par jour). À appeler boss verrouillé ; les joueurs le sont ensuite.
 */
async function payKillReward(
  tx: Tx,
  boss: BossDay,
  userIds: string[],
  opts: { killerId: string | null; late: boolean; now: Date },
  fx: Effects,
): Promise<Player[]> {
  if (!userIds.length) return [];
  const fresh = await tx
    .insert(schema.bossRewards)
    .values(userIds.map((userId) => ({ day: boss.day, userId, paidAt: opts.now })))
    .onConflictDoNothing()
    .returning({ userId: schema.bossRewards.userId });
  const players = await lockPlayers(
    tx,
    fresh.map((r) => r.userId),
  );
  const { pw, packs } = BOSS_REWARDS.kill;
  for (const p of players.values()) {
    await movePw(tx, p, pw, "boss", `boss:${boss.day}`);
    const bonusPacks = p.bonusPacks + packs;
    await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, p.userId));
    await logMovement(tx, p.userId, "bonus_pack", packs, bonusPacks, "boss", `boss:${boss.day}`);
    p.bonusPacks = bonusPacks;
    await fx.notify(tx, p.userId, "boss_killed", {
      day: boss.day,
      lastHit: p.userId === opts.killerId,
      late: opts.late,
      reward: { pw, packs },
    });
  }
  return [...players.values()];
}

/**
 * Fin d'un assaut. Boss déjà tombé : c'est un renfort, payé comme les participants de la chute s'il ne l'a
 * pas encore été (boss verrouillé d'abord, puis le joueur, comme partout).
 */
async function finishAssault(ctx: Ctx, userId: string, assaultId: number) {
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const [peek] = await tx.select({ day: ba.day }).from(ba).where(eq(ba.id, assaultId));
    if (!peek) return null;
    const [boss] = await tx.select().from(schema.bossDays).where(eq(schema.bossDays.day, peek.day)).for("update");
    const [done] = await tx
      .update(ba)
      .set({ finishedAt: ctx.now() })
      .where(and(eq(ba.id, assaultId), eq(ba.userId, userId), isNull(ba.finishedAt)))
      .returning();
    if (!done) return null;
    const paid =
      boss?.killedAt && !boss.finalizedAt
        ? await payKillReward(tx, boss, [userId], { killerId: null, late: true, now: ctx.now() }, fx)
        : [];
    return { damage: done.damage, paid };
  });
  if (!res) return;
  void emit(ctx, userId, { type: "boss_assault", damage: res.damage });
  await afterCommit(ctx, async () => {
    if (res.paid.length) {
      pushPaid(ctx, res.paid);
      void emit(ctx, userId, { type: "boss_killed", lastHit: false });
    }
    await fx.flush(ctx);
  });
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

async function hitCards(ctx: Ctx, userId: string, hits: Hit[]): Promise<Map<number, CardDTO>> {
  const cards = await instancesByIds(
    ctx.db,
    hits.map((h) => h.instanceId),
    userId,
  );
  const out = new Map<number, CardDTO>(cards.map((c) => [c.instanceId!, c]));
  // Carte vendue ou recyclée depuis : repli sur l'article (stats figées de l'assaut).
  for (const h of hits)
    if (!out.has(h.instanceId)) {
      const title = (await ctx.wiki.titleOf(h.cardId)) ?? "?";
      out.set(h.instanceId, {
        instanceId: null,
        cardId: h.cardId,
        season: h.season,
        title,
        rarity: h.rarity,
        atk: h.atk,
        def: 0,
        level: 1,
        thumbUrl: null,
        pageUrl: articleUrl(title),
      });
    }
  return out;
}

function assaultView(ctx: Ctx, assault: Assault, hits: Hit[], cards: Map<number, CardDTO>): BossAssaultDTO {
  const done: BossHitDTO[] = hits
    .filter((h) => h.answeredAt)
    .map((h) => {
      const q = h.question as Question;
      return {
        idx: h.idx,
        card: cards.get(h.instanceId)!,
        correct: !!h.correct,
        correctIndex: q.answer,
        choice: h.choice,
        answerMs: h.answerMs,
        hit: bossHit(!!h.correct, h.answerMs),
        damage: h.damage ?? 0,
      };
    });
  const open = hits.find((h) => h.servedAt && !h.answeredAt);
  let question: BossQuestionDTO | null = null;
  if (open?.question) {
    const q = open.question as Question;
    const elapsed = ctx.now().getTime() - open.servedAt!.getTime();
    const card = cards.get(open.instanceId)!;
    // Image ou « Qui suis-je ? » : la carte donnerait la réponse, elle reste face cachée jusqu'à la réponse.
    const cardHidden = cardHiddenUntilAnswer(q);
    question = {
      idx: open.idx,
      card: cardHidden ? { ...card, instanceId: null, cardId: 0, title: "", thumbUrl: null, pageUrl: null } : card,
      cardHidden,
      type: q.type,
      prompt: q.prompt,
      choices: q.choices,
      remainingMs: Math.max(0, BOSS_QUESTION_MS - elapsed),
      durationMs: BOSS_QUESTION_MS,
    };
  }
  return {
    id: assault.id,
    number: assault.number,
    hits: done,
    question,
    damage: assault.damage,
    finished: !!assault.finishedAt,
  };
}

/** Boss du jour vu par un joueur : PV, classement des assaillants, assaut en cours. */
export async function bossState(ctx: Ctx, userId: string): Promise<BossDTO> {
  const boss = await bossOfDay(ctx);
  const { card, extract } = await bossCard(ctx, boss);
  const mine = await ctx.db
    .select()
    .from(ba)
    .where(and(eq(ba.day, boss.day), eq(ba.userId, userId)))
    .orderBy(asc(ba.number));
  const running = mine.find((a) => !a.finishedAt) ?? null;
  let current: BossAssaultDTO | null = null;
  if (running) {
    const hits = await hitsOf(ctx.db, running.id);
    current = assaultView(ctx, running, hits, await hitCards(ctx, userId, hits));
  } else if (mine.length) {
    // Dernier assaut terminé : son bilan reste affiché.
    const last = mine.at(-1)!;
    const hits = await hitsOf(ctx.db, last.id);
    current = assaultView(ctx, last, hits, await hitCards(ctx, userId, hits));
  }
  const ranking = await ctx.db.execute<{ user_id: string; damage: number; name: string; username: string }>(sql`
    select a.user_id, sum(a.damage)::int as damage, coalesce(u.display_username, u.name) as name, u.username
    from boss_assaults a join "user" u on u.id = a.user_id
    where a.day = ${boss.day}
    group by a.user_id, u.display_username, u.name, u.username
    order by damage desc, u.username
  `);
  const [reward] = await ctx.db
    .select({ day: schema.bossRewards.day })
    .from(schema.bossRewards)
    .where(and(eq(schema.bossRewards.day, boss.day), eq(schema.bossRewards.userId, userId)));
  const [killer] = boss.killedBy
    ? await ctx.db.execute<{ name: string }>(
        sql`select coalesce(display_username, name) as name from "user" where id = ${boss.killedBy}`,
      )
    : [];
  return {
    day: boss.day,
    boss: card,
    extract,
    maxHp: boss.maxHp,
    hp: boss.hp,
    killedAt: boss.killedAt?.toISOString() ?? null,
    killedBy: killer?.name ?? null,
    assaultsPerDay: BOSS_ASSAULTS_PER_DAY,
    assaultsUsed: mine.length,
    cardsPerAssault: BOSS_CARDS_PER_ASSAULT,
    current,
    myDamage: mine.reduce((s, a) => s + a.damage, 0),
    rewarded: !!reward,
    ranking: ranking.map((r) => ({
      userId: r.user_id,
      name: r.name,
      username: r.username,
      damage: r.damage,
      me: r.user_id === userId,
    })),
    participants: ranking.length,
    rewards: { kill: BOSS_REWARDS.kill, mvpPacks: BOSS_REWARDS.mvpPacks, consolationPw: BOSS_REWARDS.consolationPw },
    nextAt: nextParisMidnight(ctx.now()).toISOString(),
  };
}

/** Résumé pour l'en-tête (/me) : boss encore debout, assauts restants, récompense de chute déjà touchée. */
export async function bossSummary(ctx: Ctx, userId: string) {
  const day = parisDay(ctx.now());
  const [boss] = await ctx.db.select().from(schema.bossDays).where(eq(schema.bossDays.day, day));
  const [used] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(ba)
    .where(and(eq(ba.day, day), eq(ba.userId, userId)));
  const [reward] = await ctx.db
    .select({ day: schema.bossRewards.day })
    .from(schema.bossRewards)
    .where(and(eq(schema.bossRewards.day, day), eq(schema.bossRewards.userId, userId)));
  return {
    alive: !boss || boss.hp > 0,
    assaultsLeft: Math.max(0, BOSS_ASSAULTS_PER_DAY - (used?.n ?? 0)),
    rewarded: !!reward,
  };
}

/**
 * Job de minuit, pour chaque journée passée pas encore close (idempotent, `finalized_at`, rattrape les jours
 * manqués) :
 * - boss tombé : les participants pas encore payés (assaut abandonné en cours de route) touchent la
 *   récompense de chute, et le meilleur assaillant de la journée, renforts compris, son paquet en plus ;
 * - boss debout : lot de consolation (PW) à chaque participant qui l'a touché.
 */
export async function finalizeBosses(ctx: Ctx) {
  const today = parisDay(ctx.now());
  const due = await ctx.db
    .select()
    .from(schema.bossDays)
    .where(and(lt(schema.bossDays.day, today), isNull(schema.bossDays.finalizedAt)));
  for (const boss of due) {
    const fx = new Effects();
    const res = await ctx.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(schema.bossDays).where(eq(schema.bossDays.day, boss.day)).for("update");
      if (!locked || locked.finalizedAt) return { paid: [] as Player[], late: [] as string[], mvp: null };
      await tx.update(schema.bossDays).set({ finalizedAt: ctx.now() }).where(eq(schema.bossDays.day, boss.day));
      if (locked.killedAt) return finalizeKilled(ctx, tx, locked, fx);
      const rows = await tx.execute<{ user_id: string }>(
        sql`select distinct user_id from boss_assaults where day = ${boss.day} and damage > 0`,
      );
      const players = await lockPlayers(
        tx,
        rows.map((r) => r.user_id),
      );
      for (const p of players.values()) {
        await movePw(tx, p, BOSS_REWARDS.consolationPw, "boss", `boss:${boss.day}:consolation`);
        await fx.notify(tx, p.userId, "boss_consolation", {
          day: boss.day,
          reward: { pw: BOSS_REWARDS.consolationPw },
        });
      }
      return { paid: [...players.values()], late: [] as string[], mvp: null };
    });
    await afterCommit(ctx, async () => {
      pushPaid(ctx, res.paid);
      for (const id of res.late) void emit(ctx, id, { type: "boss_killed", lastHit: false });
      if (res.mvp) void emit(ctx, res.mvp, { type: "boss_mvp" });
      await fx.flush(ctx);
    });
  }
}

/** Clôture d'un boss tombé : retardataires payés, puis paquet du meilleur assaillant de la journée. */
async function finalizeKilled(ctx: Ctx, tx: Tx, boss: BossDay, fx: Effects) {
  const rows = await tx.execute<{ user_id: string; damage: number }>(sql`
    select user_id, sum(damage)::int as damage from boss_assaults where day = ${boss.day}
    group by user_id order by damage desc, user_id
  `);
  // Tous les participants verrouillés d'emblée, dans l'ordre habituel : les relectures suivantes sont sûres.
  await lockPlayers(
    tx,
    rows.map((r) => r.user_id),
  );
  const late = await payKillReward(
    tx,
    boss,
    rows.map((r) => r.user_id),
    { killerId: null, late: true, now: ctx.now() },
    fx,
  );
  const top = rows[0];
  if (!top || top.damage <= 0) return { paid: late, late: late.map((p) => p.userId), mvp: null };
  // Relu après les paiements ci-dessus (déjà verrouillé par cette transaction).
  const p = (await lockPlayers(tx, [top.user_id])).get(top.user_id)!;
  const bonusPacks = p.bonusPacks + BOSS_REWARDS.mvpPacks;
  await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, p.userId));
  await logMovement(tx, p.userId, "bonus_pack", BOSS_REWARDS.mvpPacks, bonusPacks, "boss", `boss:${boss.day}:mvp`);
  p.bonusPacks = bonusPacks;
  await fx.notify(tx, p.userId, "boss_mvp", {
    day: boss.day,
    damage: top.damage,
    reward: { packs: BOSS_REWARDS.mvpPacks },
  });
  const paid = [...late.filter((x) => x.userId !== p.userId), p];
  return { paid, late: late.map((x) => x.userId), mvp: p.userId };
}

/** Pousse solde et paquets des joueurs payés par la chute du boss. */
export function pushPaid(ctx: Ctx, players: Player[]) {
  for (const p of players) {
    pushWallet(ctx, p);
    ctx.rt.toUser(p.userId, "packs:update", packState(p, ctx.now()));
  }
}
