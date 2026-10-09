import { and, asc, eq, inArray, isNull, lt, schema, sql } from "@palacards/db";
import {
  articleCategory,
  BOSS_ANSWER_GRACE_MS,
  BOSS_ASSAULTS_PER_DAY,
  BOSS_CARDS_PER_ASSAULT,
  BOSS_FATIGUE_DAYS,
  BOSS_HP_WINDOW_DAYS,
  BOSS_PHASE_MIN_DAMAGE,
  BOSS_RESISTANCE_MULT,
  BOSS_REWARDS,
  BOSS_VERSION,
  BOSS_WEAKNESS_MULT,
  addDays,
  bossDamage,
  bossDayReward,
  bossDayRule,
  bossHit,
  bossPhase1Hp,
  bossPhaseHp,
  bossPhaseState,
  bossQuestionMs,
  bossQuestionMult,
  categoryMult,
  effectiveStats,
  fatigueRestDays,
  fatigueSince,
  isDuel,
  parisDay,
  seededRandom,
  type ArticleCategory,
  type BossHit,
  type BossQuestion,
  type BossRule,
} from "@palacards/game";
import type {
  BossAssaultDTO,
  BossCardDTO,
  BossCardsDTO,
  BossDTO,
  BossHitDTO,
  BossLiveDTO,
  BossQuestionDTO,
  CardDTO,
} from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { instancesByIds } from "./cards.js";
import { afterCommit, Effects } from "./notifications.js";
import { activeSeason, lockPlayers, logMovement, movePw, packState, pushWallet, type Player } from "./players.js";
import { emit } from "./progression.js";
import { bossQuestion, QUESTION_PREP_MS, withTimeout } from "./quiz.js";
import { nextParisMidnight } from "./wheel.js";
import { articleUrl } from "./wiki.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type BossDay = typeof schema.bossDays.$inferSelect;
type Assault = typeof schema.bossAssaults.$inferSelect;
type Hit = typeof schema.bossHits.$inferSelect;

export const BOSS_FINALIZE_JOB = "boss-finalize";

const ba = schema.bossAssaults;
const bh = schema.bossHits;

const ruleOf = (boss: BossDay): BossRule | null =>
  boss.weakness && boss.resistance
    ? { weakness: boss.weakness as ArticleCategory, resistance: boss.resistance as ArticleCategory }
    : null;

/** Règle du jour (faiblesse, résistance), jamais celle de la veille. */
async function dayRule(ctx: Ctx, day: string): Promise<BossRule> {
  const [prev] = await ctx.db
    .select()
    .from(schema.bossDays)
    .where(eq(schema.bossDays.day, addDays(day, -1)));
  return bossDayRule(day, prev ? ruleOf(prev) : null);
}

/**
 * Boss du jour : une Légendaire de la saison, tirée d'après le jour, créée à la première demande. PV de la
 * phase 1 calés sur les dégâts des derniers jours ; règle du jour (faiblesse, résistance) tirée à la création.
 * Un boss d'avant les phases (jour de la mise à jour) reçoit sa règle à la première demande.
 */
export async function bossOfDay(ctx: Ctx, day = parisDay(ctx.now())): Promise<BossDay> {
  const [existing] = await ctx.db.select().from(schema.bossDays).where(eq(schema.bossDays.day, day));
  if (existing) {
    if (ruleOf(existing)) return existing;
    const rule = await dayRule(ctx, day);
    const [updated] = await ctx.db
      .update(schema.bossDays)
      .set({ weakness: rule.weakness, resistance: rule.resistance })
      .where(and(eq(schema.bossDays.day, day), isNull(schema.bossDays.weakness)))
      .returning();
    return updated ?? (await ctx.db.select().from(schema.bossDays).where(eq(schema.bossDays.day, day)))[0]!;
  }
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
  const maxHp = bossPhase1Hp(await damageHistory(ctx, day));
  const rule = await dayRule(ctx, day);
  await ctx.db
    .insert(schema.bossDays)
    .values({
      day,
      cardId: Number(row.id),
      season,
      maxHp,
      hp: maxHp,
      version: BOSS_VERSION,
      weakness: rule.weakness,
      resistance: rule.resistance,
    })
    .onConflictDoNothing();
  const [boss] = await ctx.db.select().from(schema.bossDays).where(eq(schema.bossDays.day, day));
  const title = (await ctx.wiki.titleOf(boss!.cardId)) ?? "";
  void ctx.wiki.load([{ cardId: boss!.cardId, title }]).catch(() => {});
  void ctx.wiki.loadAttributes([boss!.cardId]).catch(() => {});
  return boss!;
}

/** Dégâts totaux par jour sur la fenêtre (jours d'assaut seulement), avec le format du boss de chaque jour. */
async function damageHistory(ctx: Ctx, day: string) {
  const rows = await ctx.db.execute<{ damage: number; version: number }>(sql`
    select sum(a.damage)::int as damage, coalesce(min(b.version), 1)::int as version
    from boss_assaults a left join boss_days b on b.day = a.day
    where a.day < ${day}::date and a.day >= ${day}::date - ${BOSS_HP_WINDOW_DAYS}::int
    group by a.day
  `);
  return rows.map((r) => ({ damage: Number(r.damage), legacy: Number(r.version) < BOSS_VERSION }));
}

async function bossCard(ctx: Ctx, boss: BossDay) {
  const [row] = await ctx.db.execute<{
    title: string;
    atk: number;
    def: number;
    views_12m: string;
    thumb_url: string | null;
    page_url: string | null;
    extract: string | null;
    description: string | null;
  }>(sql`
    select c.title, c.atk, c.def, c.views_12m, s.thumb_url, s.page_url, s.extract, s.description from cards c
    left join wiki_summaries s on s.page_id = c.id
    where c.season = ${boss.season} and c.id = ${boss.cardId}
  `);
  const card: CardDTO = {
    instanceId: null,
    cardId: boss.cardId,
    season: boss.season,
    title: row?.title ?? "?",
    rarity: "L",
    atk: row?.atk ?? 0,
    def: row?.def ?? 0,
    level: 1,
    views12m: Number(row?.views_12m ?? 0),
    thumbUrl: row?.thumb_url ?? null,
    pageUrl: row?.page_url ?? articleUrl(row?.title ?? ""),
  };
  return { card, extract: row?.extract ?? null, category: articleCategory(row?.description) };
}

// ---------------------------------------------------------------------------
// Cartes jouables : catégorie, dégâts du jour, repos
// ---------------------------------------------------------------------------

/** Articles joués contre le boss depuis le premier jour encore « fatigué », et le dernier jour de chacun. */
async function tiredCards(db: Ctx["db"] | Tx, userId: string, today: string): Promise<Map<number, number>> {
  const rows = await db.execute<{ card_id: string; day: string }>(sql`
    select h.card_id, max(a.day)::text as day from boss_hits h join boss_assaults a on a.id = h.assault_id
    where a.user_id = ${userId} and a.day >= ${fatigueSince(today)}::date
    group by h.card_id
  `);
  return new Map(rows.map((r) => [Number(r.card_id), fatigueRestDays(r.day, today)]));
}

/** Articles affichés dans le sélecteur (les plus efficaces d'abord). */
const PICKER_LIMIT = 60;

/**
 * Articles de la collection pour un assaut : le meilleur exemplaire de chaque article (ATK au niveau actuel),
 * sa catégorie, ses dégâts du jour (faiblesse ou résistance comprise) et ses jours de repos.
 */
export async function bossCards(ctx: Ctx, userId: string): Promise<BossCardsDTO> {
  const boss = await bossOfDay(ctx);
  const rule = ruleOf(boss)!;
  const rows = await ctx.db.execute<{
    id: string;
    card_id: string;
    season: number;
    title: string;
    rarity: CardDTO["rarity"];
    atk: number;
    def: number;
    level: number;
    shiny: boolean;
    description: string | null;
    thumb_url: string | null;
    summary: boolean;
  }>(sql`
    select i.id, i.card_id, i.season, c.title, i.rarity, i.atk, i.def, i.level, i.shiny,
           s.description, s.thumb_url, s.page_id is not null as summary
    from card_instances i
    join cards c on c.season = i.season and c.id = i.card_id
    left join wiki_summaries s on s.page_id = i.card_id
    where i.owner_id = ${userId}
  `);
  // Meilleur exemplaire de chaque article (ATK effective).
  const best = new Map<number, (typeof rows)[number] & { eff: number }>();
  for (const r of rows) {
    const eff = effectiveStats(r.atk, r.def, r.level).atk;
    const cur = best.get(Number(r.card_id));
    if (!cur || eff > cur.eff) best.set(Number(r.card_id), { ...r, eff });
  }
  // Résumés manquants des plus fortes : chargés un instant (catégorie d'après la description).
  const missing = [...best.values()]
    .filter((r) => !r.summary)
    .sort((a, b) => b.eff - a.eff)
    .slice(0, 40)
    .map((r) => ({ cardId: Number(r.card_id), title: r.title }));
  let summaries = new Map<number, { description: string | null; thumbUrl: string | null }>();
  if (missing.length) {
    await withTimeout(ctx.wiki.load(missing), 2_500, []);
    summaries = await ctx.wiki.summaries(missing.map((m) => m.cardId));
  }
  const tired = await tiredCards(ctx.db, userId, boss.day);
  const items: BossCardDTO[] = [...best.values()].map((r) => {
    const cardId = Number(r.card_id);
    const category = articleCategory(r.description ?? summaries.get(cardId)?.description);
    const mult = categoryMult(category, rule);
    return {
      instanceId: Number(r.id),
      cardId,
      title: r.title,
      rarity: r.rarity,
      atk: r.eff,
      level: r.level,
      shiny: r.shiny,
      thumbUrl: r.thumb_url ?? summaries.get(cardId)?.thumbUrl ?? null,
      category,
      mult,
      damage: bossDamage(r.eff, 1, mult),
      critDamage: bossDamage(r.eff, 1.5, mult),
      restDays: tired.get(cardId) ?? 0,
    };
  });
  const ready = items
    .filter((c) => c.restDays === 0)
    .sort((a, b) => b.damage - a.damage || b.atk - a.atk || a.title.localeCompare(b.title, "fr"));
  const resting = items.filter((c) => c.restDays > 0).sort((a, b) => a.restDays - b.restDays || b.damage - a.damage);
  return { items: [...ready.slice(0, PICKER_LIMIT), ...resting], available: ready.length, total: items.length };
}

// ---------------------------------------------------------------------------
// Questions (préparées à l'avance, figées en base au moment où elles sont posées)
// ---------------------------------------------------------------------------

const preparing = new Map<string, Promise<BossQuestion>>();

function questionFor(ctx: Ctx, boss: BossDay, assault: Assault, hit: Hit, hits: Hit[]): Promise<BossQuestion> {
  const key = `${assault.id}:${hit.idx}`;
  let p = preparing.get(key);
  if (!p) {
    const avoid = hits.flatMap((h) => {
      const type = (h.question as BossQuestion | null)?.type;
      return type ? [type] : [];
    });
    p = bossQuestion(ctx, {
      seed: `boss:${assault.day}:${assault.userId}:${assault.id}:${hit.idx}`,
      userId: assault.userId,
      cardId: hit.cardId,
      season: hit.season,
      rarity: hit.rarity,
      avoid,
      boss: { cardId: boss.cardId, season: boss.season },
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
function prefetchNext(ctx: Ctx, boss: BossDay, assault: Assault, hits: Hit[]) {
  const next = hits.find((h) => !h.servedAt);
  if (!next) return;
  void questionFor(ctx, boss, assault, next, hits).catch(() => {});
}

// ---------------------------------------------------------------------------
// Assauts
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/**
 * Démarre un assaut : 5 articles différents de sa collection (copiés tels quels : ATK au niveau actuel,
 * catégorie et multiplicateur du jour), aucun au repos.
 */
export async function startAssault(ctx: Ctx, userId: string, instanceIds: number[]) {
  const ids = [...new Set(instanceIds)];
  if (ids.length !== BOSS_CARDS_PER_ASSAULT)
    throw badRequest("boss_cards", `Choisis ${BOSS_CARDS_PER_ASSAULT} cartes différentes.`);
  const boss = await bossOfDay(ctx);
  const rule = ruleOf(boss)!;
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
      .select({
        id: schema.cardInstances.id,
        cardId: schema.cardInstances.cardId,
        season: schema.cardInstances.season,
        rarity: schema.cardInstances.rarity,
        atk: schema.cardInstances.atk,
        def: schema.cardInstances.def,
        level: schema.cardInstances.level,
        title: schema.cards.title,
        description: schema.wikiSummaries.description,
      })
      .from(schema.cardInstances)
      .innerJoin(
        schema.cards,
        and(eq(schema.cards.season, schema.cardInstances.season), eq(schema.cards.id, schema.cardInstances.cardId)),
      )
      .leftJoin(schema.wikiSummaries, eq(schema.wikiSummaries.pageId, schema.cardInstances.cardId))
      .where(and(inArray(schema.cardInstances.id, ids), eq(schema.cardInstances.ownerId, userId)));
    if (cards.length !== ids.length) throw notFound("Certaines cartes ne sont plus dans ta collection.");
    if (new Set(cards.map((c) => c.cardId)).size !== cards.length)
      throw badRequest(
        "boss_same_article",
        "Choisis cinq articles différents : deux exemplaires du même ne comptent qu'une fois.",
      );
    const tired = await tiredCards(tx, userId, boss.day);
    const resting = cards.find((c) => (tired.get(c.cardId) ?? 0) > 0);
    if (resting) {
      const n = tired.get(resting.cardId)!;
      throw conflict(
        "card_tired",
        `« ${resting.title} » se repose encore ${n} ${plural(n, "jour", "jours")} : un article joué contre le boss ne revient qu'au bout de ${BOSS_FATIGUE_DAYS} jours.`,
      );
    }
    const [created] = await tx
      .insert(ba)
      .values({ day: boss.day, userId, number: mine.length + 1, startedAt: ctx.now() })
      .returning();
    const byId = new Map(cards.map((c) => [c.id, c]));
    await tx.insert(bh).values(
      ids.map((id, idx) => {
        const c = byId.get(id)!;
        const category = articleCategory(c.description);
        return {
          assaultId: created!.id,
          idx,
          instanceId: c.id,
          cardId: c.cardId,
          season: c.season,
          rarity: c.rarity,
          atk: effectiveStats(c.atk, c.def, c.level).atk,
          category,
          mult: categoryMult(category, rule),
        };
      }),
    );
    return created!;
  });
  prefetchNext(ctx, boss, assault, await hitsOf(ctx.db, assault.id));
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

/** Pose la question suivante de l'assaut (ou le termine après la cinquième), et la note dans l'historique. */
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
    const [boss] = await ctx.db.select().from(schema.bossDays).where(eq(schema.bossDays.day, assault.day));
    // Préparation trop longue (Wikipédia lent) : on repart de ce qui est en cache.
    const question =
      (await withTimeout(questionFor(ctx, boss!, assault, next, hits), QUESTION_PREP_MS + 2_000, null)) ??
      (await questionFor(ctx, boss!, { ...assault, id: -assault.id }, next, hits));
    const now = ctx.now();
    const [served] = await ctx.db
      .update(bh)
      .set({ question, servedAt: now })
      .where(and(eq(bh.assaultId, assaultId), eq(bh.idx, next.idx), isNull(bh.servedAt)))
      .returning({ idx: bh.idx });
    if (served)
      await ctx.db
        .insert(schema.bossQuestionHistory)
        .values({ userId, cardId: next.cardId, type: question.type, key: question.key, askedAt: now })
        .onConflictDoUpdate({
          target: [
            schema.bossQuestionHistory.userId,
            schema.bossQuestionHistory.cardId,
            schema.bossQuestionHistory.type,
            schema.bossQuestionHistory.key,
          ],
          set: { askedAt: now },
        });
    prefetchNext(ctx, boss!, assault, await hitsOf(ctx.db, assaultId));
  } else if (!open && !next && !assault.finishedAt) {
    await finishAssault(ctx, userId, assaultId);
  }
  return bossState(ctx, userId);
}

/** Question posée, chrono (et marge) dépassé : réponse absente, aucun dégât. */
async function expireOpenQuestion(ctx: Ctx, userId: string, assault: Assault, hits: Hit[]) {
  const open = hits.find((h) => h.servedAt && !h.answeredAt);
  if (!open?.question) return;
  const elapsed = ctx.now().getTime() - open.servedAt!.getTime();
  if (elapsed <= questionMs(open) + BOSS_ANSWER_GRACE_MS) return;
  await resolveHit(ctx, userId, assault.id, open.idx, null);
}

const questionMs = (h: Hit) => bossQuestionMs((h.question as BossQuestion).type);

export type BossAnswer = { choice: number } | { year: number };

/** Répond à la question en cours de l'assaut (un choix, ou une année tapée). */
export async function answerBoss(ctx: Ctx, userId: string, assaultId: number, idx: number, answer: BossAnswer) {
  await resolveHit(ctx, userId, assaultId, idx, answer);
  return bossState(ctx, userId);
}

/**
 * Résout une question : temps mesuré par le serveur, dégâts selon l'ATK de la carte, la question et la règle
 * du jour. Une transaction : boss verrouillé d'abord, dégâts ajoutés à la journée ; les phases qui tombent sont
 * notées (quand, par qui). Les récompenses attendent minuit.
 */
async function resolveHit(ctx: Ctx, userId: string, assaultId: number, idx: number, answer: BossAnswer | null) {
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
    const question = hit.question as BossQuestion;
    const durationMs = bossQuestionMs(question.type);
    const elapsed = now.getTime() - hit.servedAt.getTime();
    const late = elapsed > durationMs + BOSS_ANSWER_GRACE_MS;
    const answerMs = answer && !late ? Math.min(elapsed, durationMs) : null;
    let choice: number | null = null;
    let guessYear: number | null = null;
    let kind: BossHit;
    if (question.type === "year_input") {
      if (answer && "choice" in answer) throw badRequest("year_expected", "Tape une année.");
      guessYear = answer && !late ? answer.year : null;
      kind = bossHit({ kind: "year", guess: guessYear, answer: question.answer });
    } else {
      if (answer && "year" in answer) throw badRequest("choice_expected", "Choisis une des réponses.");
      const valid = !!answer && !late && answer.choice >= 0 && answer.choice < question.choices.length;
      choice = valid ? answer.choice : null;
      kind = bossHit({
        kind: isDuel(question.type) ? "duel" : "choice",
        correct: valid && answer.choice === question.answer,
        answerMs,
      });
    }
    const qMult = bossQuestionMult(question.type, kind, { guess: guessYear, answer: question.answer });
    const damage = bossDamage(hit.atk, qMult, hit.mult ?? 1);
    await tx
      .update(bh)
      .set({ answeredAt: now, choice, guessYear, correct: kind !== "miss", answerMs, damage })
      .where(and(eq(bh.assaultId, assaultId), eq(bh.idx, idx)));
    await tx
      .update(ba)
      .set({ damage: assault.damage + damage })
      .where(eq(ba.id, assaultId));

    const before = bossPhaseState(boss!.maxHp, boss!.damage);
    const after = bossPhaseState(boss!.maxHp, boss!.damage + damage);
    if (damage > 0) {
      await tx
        .update(schema.bossDays)
        .set({ damage: boss!.damage + damage, phase: after.phase, hp: after.hp })
        .where(eq(schema.bossDays.day, boss!.day));
      for (let k = before.phase; k < after.phase; k++)
        await tx
          .insert(schema.bossPhases)
          .values({ day: boss!.day, phase: k, maxHp: bossPhaseHp(boss!.maxHp, k), fallenAt: now, fallenBy: userId })
          .onConflictDoNothing();
    }
    const fell: number[] = [];
    for (let k = before.phase; k < after.phase; k++) fell.push(k);
    return { boss: boss!, after, totalDamage: boss!.damage + damage, damage, kind, fell };
  });
  const [u] = await ctx.db.execute<{ name: string }>(
    sql`select coalesce(display_username, name) as name from "user" where id = ${userId}`,
  );
  await afterCommit(ctx, async () => {
    const name = u?.name ?? "?";
    const live: BossLiveDTO = {
      day: res.boss.day,
      phase: res.after.phase,
      hp: res.after.hp,
      maxHp: res.after.maxHp,
      totalDamage: res.totalDamage,
      fell: res.fell.map((phase) => ({ phase, by: name })),
      last: { name, damage: res.damage, hit: res.kind },
    };
    ctx.rt.toAll("boss:update", live);
  });
}

/** Fin d'un assaut : ses dégâts comptent pour les quêtes et les succès. */
async function finishAssault(ctx: Ctx, userId: string, assaultId: number) {
  const [done] = await ctx.db
    .update(ba)
    .set({ finishedAt: ctx.now() })
    .where(and(eq(ba.id, assaultId), eq(ba.userId, userId), isNull(ba.finishedAt)))
    .returning();
  if (done) void emit(ctx, userId, { type: "boss_assault", damage: done.damage });
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

const categoryOf = (h: Hit) => (h.category ?? "autre") as ArticleCategory;

function assaultView(ctx: Ctx, assault: Assault, hits: Hit[], cards: Map<number, CardDTO>): BossAssaultDTO {
  const done: BossHitDTO[] = hits
    .filter((h) => h.answeredAt)
    .map((h) => {
      const q = h.question as BossQuestion;
      const year = q.type === "year_input";
      const hit: BossHit = !h.correct
        ? "miss"
        : year
          ? bossHit({ kind: "year", guess: h.guessYear, answer: q.answer })
          : bossHit({ kind: isDuel(q.type) ? "duel" : "choice", correct: true, answerMs: h.answerMs });
      return {
        idx: h.idx,
        card: cards.get(h.instanceId)!,
        type: q.type,
        correct: !!h.correct,
        correctIndex: year ? null : q.answer,
        correctYear: year ? q.answer : null,
        choice: h.choice,
        guessYear: h.guessYear,
        answerMs: h.answerMs,
        hit,
        category: categoryOf(h),
        mult: h.mult ?? 1,
        damage: h.damage ?? 0,
      };
    });
  const open = hits.find((h) => h.servedAt && !h.answeredAt);
  let question: BossQuestionDTO | null = null;
  if (open?.question) {
    const q = open.question as BossQuestion;
    const durationMs = bossQuestionMs(q.type);
    const elapsed = ctx.now().getTime() - open.servedAt!.getTime();
    const card = cards.get(open.instanceId)!;
    // Image : la carte donnerait la réponse, elle reste face cachée jusqu'à la réponse.
    question = {
      idx: open.idx,
      card: q.cardHidden ? { ...card, instanceId: null, cardId: 0, title: "", thumbUrl: null, pageUrl: null } : card,
      cardHidden: q.cardHidden,
      type: q.type,
      input: q.type === "year_input" ? "year" : "choice",
      prompt: q.prompt,
      choices: q.choices,
      category: categoryOf(open),
      mult: open.mult ?? 1,
      remainingMs: Math.max(0, durationMs - elapsed),
      durationMs,
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

/** Phases tombées (et par qui), puis la phase en cours. */
async function phasesOf(ctx: Ctx, boss: BossDay) {
  const fallen = await ctx.db.execute<{ phase: number; max_hp: number; fallen_at: Date | string; name: string | null }>(
    sql`
    select p.phase, p.max_hp, p.fallen_at, coalesce(u.display_username, u.name) as name
    from boss_phases p left join "user" u on u.id = p.fallen_by
    where p.day = ${boss.day} order by p.phase
  `,
  );
  const state = bossPhaseState(boss.maxHp, boss.damage);
  return {
    state,
    phases: [
      ...fallen.map((p) => ({
        phase: Number(p.phase),
        maxHp: Number(p.max_hp),
        fallenAt: new Date(p.fallen_at).toISOString(),
        fallenBy: p.name,
      })),
      { phase: state.phase, maxHp: state.maxHp, fallenAt: null, fallenBy: null },
    ],
  };
}

/** Phases déjà payées à un joueur ce jour-là (2 : chute de l'ancien format payée sur le moment). */
async function paidPhases(db: Ctx["db"] | Tx, day: string, userId: string): Promise<number> {
  const [r] = await db
    .select({ phases: schema.bossRewards.phases })
    .from(schema.bossRewards)
    .where(and(eq(schema.bossRewards.day, day), eq(schema.bossRewards.userId, userId)));
  return r?.phases ?? 0;
}

/** Boss du jour vu par un joueur : phase et PV, règle du jour, classement, assaut en cours, gains acquis. */
export async function bossState(ctx: Ctx, userId: string): Promise<BossDTO> {
  const boss = await bossOfDay(ctx);
  const rule = ruleOf(boss)!;
  const { card, extract, category } = await bossCard(ctx, boss);
  const mine = await ctx.db
    .select()
    .from(ba)
    .where(and(eq(ba.day, boss.day), eq(ba.userId, userId)))
    .orderBy(asc(ba.number));
  const running = mine.find((a) => !a.finishedAt) ?? null;
  const shown = running ?? mine.at(-1) ?? null;
  let current: BossAssaultDTO | null = null;
  if (shown) {
    // Assaut en cours, ou bilan du dernier assaut terminé.
    const hits = await hitsOf(ctx.db, shown.id);
    current = assaultView(ctx, shown, hits, await hitCards(ctx, userId, hits));
  }
  const ranking = await ctx.db.execute<{ user_id: string; damage: number; name: string; username: string }>(sql`
    select a.user_id, sum(a.damage)::int as damage, coalesce(u.display_username, u.name) as name, u.username
    from boss_assaults a join "user" u on u.id = a.user_id
    where a.day = ${boss.day}
    group by a.user_id, u.display_username, u.name, u.username
    order by damage desc, u.username
  `);
  const { state, phases } = await phasesOf(ctx, boss);
  const myDamage = mine.reduce((s, a) => s + a.damage, 0);
  const reward = bossDayReward({
    fallen: state.fallen,
    damage: myDamage,
    paidPhases: await paidPhases(ctx.db, boss.day, userId),
  });
  const top = ranking[0];
  return {
    day: boss.day,
    boss: card,
    bossCategory: category,
    extract,
    phase: state.phase,
    maxHp: state.maxHp,
    hp: state.hp,
    totalDamage: boss.damage,
    phases,
    rule: {
      weakness: rule.weakness,
      resistance: rule.resistance,
      weaknessMult: BOSS_WEAKNESS_MULT,
      resistanceMult: BOSS_RESISTANCE_MULT,
    },
    assaultsPerDay: BOSS_ASSAULTS_PER_DAY,
    assaultsUsed: mine.length,
    cardsPerAssault: BOSS_CARDS_PER_ASSAULT,
    current,
    myDamage,
    earned: {
      pw: reward.pw,
      packs: reward.packs,
      phases: reward.phases,
      consolation: reward.consolation,
      mvp: !!top && top.user_id === userId && top.damage > 0,
      missing: Math.max(0, BOSS_PHASE_MIN_DAMAGE - myDamage),
    },
    ranking: ranking.map((r) => ({
      userId: r.user_id,
      name: r.name,
      username: r.username,
      damage: r.damage,
      me: r.user_id === userId,
    })),
    participants: ranking.length,
    rewards: {
      phases: BOSS_REWARDS.phases.map((r) => ({ ...r })),
      laterPhase: { ...BOSS_REWARDS.laterPhase },
      mvpPacks: BOSS_REWARDS.mvpPacks,
      consolationPw: BOSS_REWARDS.consolationPw,
      minDamage: BOSS_PHASE_MIN_DAMAGE,
    },
    fatigueDays: BOSS_FATIGUE_DAYS,
    nextAt: nextParisMidnight(ctx.now()).toISOString(),
  };
}

/** Résumé pour l'en-tête (/me) : assauts restants, phase en cours. */
export async function bossSummary(ctx: Ctx, userId: string) {
  const day = parisDay(ctx.now());
  const [boss] = await ctx.db.select().from(schema.bossDays).where(eq(schema.bossDays.day, day));
  const [used] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(ba)
    .where(and(eq(ba.day, day), eq(ba.userId, userId)));
  return {
    assaultsLeft: Math.max(0, BOSS_ASSAULTS_PER_DAY - (used?.n ?? 0)),
    phase: boss ? bossPhaseState(boss.maxHp, boss.damage).phase : 1,
  };
}

// ---------------------------------------------------------------------------
// Clôture de minuit
// ---------------------------------------------------------------------------

/**
 * Job de minuit, pour chaque journée passée pas encore close (idempotent, `finalized_at`, rattrape les jours
 * manqués). Boss verrouillé, puis tous les participants (toujours dans cet ordre) :
 * - phases tombées : chaque joueur au-delà du seuil de dégâts touche les phases pas encore payées ;
 * - sinon (ou sous le seuil), lot de consolation à ceux qui ont touché le boss ;
 * - le meilleur assaillant de la journée reçoit un paquet de plus.
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
      if (!locked || locked.finalizedAt) return null;
      await tx.update(schema.bossDays).set({ finalizedAt: ctx.now() }).where(eq(schema.bossDays.day, boss.day));
      return finalizeDay(ctx, tx, locked, fx);
    });
    if (!res) continue;
    await afterCommit(ctx, async () => {
      pushPaid(ctx, res.paid);
      for (const e of res.events) void emit(ctx, e.userId, e.event);
      await fx.flush(ctx);
    });
  }
}

type BossEvent = { type: "boss_phase"; phase: number; lastHit: boolean } | { type: "boss_mvp" };

async function finalizeDay(ctx: Ctx, tx: Tx, boss: BossDay, fx: Effects) {
  const rows = await tx.execute<{ user_id: string; damage: number }>(sql`
    select user_id, sum(damage)::int as damage from boss_assaults where day = ${boss.day}
    group by user_id order by damage desc, user_id
  `);
  const fallenBy = new Map(
    (
      await tx
        .select({ phase: schema.bossPhases.phase, by: schema.bossPhases.fallenBy })
        .from(schema.bossPhases)
        .where(eq(schema.bossPhases.day, boss.day))
    ).map((p) => [p.phase, p.by]),
  );
  const { fallen } = bossPhaseState(boss.maxHp, boss.damage);
  const paid = new Map(
    (
      await tx
        .select({ userId: schema.bossRewards.userId, phases: schema.bossRewards.phases })
        .from(schema.bossRewards)
        .where(eq(schema.bossRewards.day, boss.day))
    ).map((r) => [r.userId, r.phases]),
  );
  // Tous les participants verrouillés d'emblée, dans l'ordre habituel.
  const players = await lockPlayers(
    tx,
    rows.map((r) => r.user_id),
  );
  const events: { userId: string; event: BossEvent }[] = [];
  const touched = new Set<string>();
  for (const r of rows) {
    const p = players.get(r.user_id);
    if (!p) continue;
    const already = paid.get(r.user_id) ?? 0;
    const reward = bossDayReward({ fallen, damage: r.damage, paidPhases: already });
    if (!reward.pw && !reward.packs) continue;
    touched.add(p.userId);
    const ref = `boss:${boss.day}${reward.consolation ? ":consolation" : ""}`;
    if (reward.pw) await movePw(tx, p, reward.pw, "boss", ref);
    if (reward.packs) {
      const bonusPacks = p.bonusPacks + reward.packs;
      await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, p.userId));
      await logMovement(tx, p.userId, "bonus_pack", reward.packs, bonusPacks, "boss", ref);
      p.bonusPacks = bonusPacks;
    }
    await tx
      .insert(schema.bossRewards)
      .values({ day: boss.day, userId: p.userId, phases: Math.max(already, ...reward.phases, 0), paidAt: ctx.now() })
      .onConflictDoUpdate({
        target: [schema.bossRewards.day, schema.bossRewards.userId],
        set: { phases: Math.max(already, ...reward.phases, 0), paidAt: ctx.now() },
      });
    if (reward.consolation) {
      await fx.notify(tx, p.userId, "boss_consolation", {
        day: boss.day,
        fallen,
        reward: { pw: reward.pw },
      });
    } else {
      await fx.notify(tx, p.userId, "boss_phase", {
        day: boss.day,
        phases: reward.phases,
        fallen,
        reward: { pw: reward.pw, packs: reward.packs },
      });
      for (const phase of reward.phases)
        events.push({
          userId: p.userId,
          event: { type: "boss_phase", phase, lastHit: fallenBy.get(phase) === p.userId },
        });
    }
  }
  const top = rows[0];
  if (top && top.damage > 0) {
    const p = players.get(top.user_id)!;
    const bonusPacks = p.bonusPacks + BOSS_REWARDS.mvpPacks;
    await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, p.userId));
    await logMovement(tx, p.userId, "bonus_pack", BOSS_REWARDS.mvpPacks, bonusPacks, "boss", `boss:${boss.day}:mvp`);
    p.bonusPacks = bonusPacks;
    touched.add(p.userId);
    await fx.notify(tx, p.userId, "boss_mvp", {
      day: boss.day,
      damage: top.damage,
      reward: { packs: BOSS_REWARDS.mvpPacks },
    });
    events.push({ userId: p.userId, event: { type: "boss_mvp" } });
  }
  return { paid: [...players.values()].filter((p) => touched.has(p.userId)), events };
}

/** Pousse solde et paquets des joueurs payés. */
export function pushPaid(ctx: Ctx, players: Player[]) {
  for (const p of players) {
    pushWallet(ctx, p);
    ctx.rt.toUser(p.userId, "packs:update", packState(p, ctx.now()));
  }
}
