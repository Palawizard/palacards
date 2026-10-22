import { and, desc, eq, schema, sql } from "@palacards/db";
import {
  HL_CHOICE_MS,
  HL_REVEAL_MS,
  HL_RARITIES,
  HL_TRIES_PER_DAY,
  hlCorrect,
  hlEligibleDescription,
  hlEligibleTitle,
  hlExpired,
  hlReward,
  hlShareText,
  hlViewRange,
  hlWidenedBands,
  isArthropod,
  parisDay,
  pickChallenger,
  unusableQuizImage,
} from "@palacards/game";
import type { HlAnswerDTO, HlArticleDTO, HlPairDTO, HlStateDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { conflict } from "../errors.js";
import { afterCommit } from "./notifications.js";
import { activeSeason, lockPlayer, movePw, pushWallet, type DbOrTx } from "./players.js";
import { emit } from "./progression.js";
import { nextParisMidnight } from "./wheel.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type Run = typeof schema.hlRuns.$inferSelect;

const runs = schema.hlRuns;
/** Articles lus par requête de candidats (filtrés ensuite : image, listes, homonymie, arthropodes). */
const SAMPLE = 40;
const RAND_SCALE = 2 ** 30;
const rarities = sql.join(
  HL_RARITIES.map((r) => sql`${r}::rarity`),
  sql`, `,
);

/** Vignette utilisable (reprise de l'article du jour) : pas de SVG, de logo ni d'image par défaut. */
const usableImage = (url: string | null) => (url && !unusableQuizImage(url) ? url : null);

interface PoolRow {
  id: number;
  season: number;
  title: string;
  views: number;
  thumbUrl: string;
  description: string | null;
}

/**
 * Articles du pool : Super rares, Ultra rares et Légendaires de la saison active, avec une image utilisable et
 * un résumé en cache, jamais une liste ni une page d'homonymie, jamais un article déjà montré au joueur ce
 * jour-là ; option « masquer les arthropodes » respectée. `where` et `order` choisissent la tranche lue.
 */
async function poolRows(
  db: DbOrTx,
  userId: string,
  day: string,
  season: number,
  hideArthropods: boolean,
  where: ReturnType<typeof sql>,
  order: ReturnType<typeof sql>,
): Promise<PoolRow[]> {
  const rows = await db.execute<{
    id: string;
    season: number;
    title: string;
    views_12m: string;
    thumb_url: string | null;
    description: string | null;
    extract: string | null;
    arthropod: boolean | null;
  }>(sql`
    select c.id, c.season, c.title, c.views_12m, s.thumb_url, s.description, s.extract, s.arthropod
    from cards c
    join wiki_summaries s on s.page_id = c.id and s.status = 'ok' and s.thumb_url is not null
    where c.season = ${season} and c.rarity in (${rarities}) and ${where}
      and not exists (select 1 from hl_seen h where h.user_id = ${userId} and h.day = ${day} and h.card_id = c.id)
    order by ${order}
    limit ${SAMPLE}
  `);
  return rows
    .filter(
      (r) =>
        usableImage(r.thumb_url) &&
        hlEligibleTitle(r.title) &&
        hlEligibleDescription(r.description) &&
        !(hideArthropods && (r.arthropod ?? isArthropod(r))),
    )
    .map((r) => ({
      id: Number(r.id),
      season: r.season,
      title: r.title,
      views: Number(r.views_12m),
      thumbUrl: r.thumb_url!,
      description: r.description,
    }));
}

/** Premier article d'un essai : au hasard dans le pool (clé de tirage, jamais ORDER BY random()). */
async function firstArticle(ctx: Ctx, db: DbOrTx, userId: string, day: string, season: number, hide: boolean) {
  const key = ctx.random(RAND_SCALE) / RAND_SCALE;
  for (const from of [key, 0]) {
    const rows = await poolRows(db, userId, day, season, hide, sql`c.rand_key >= ${from}`, sql`c.rand_key`);
    if (rows.length) return rows[ctx.random(rows.length)]!;
  }
  return null;
}

/**
 * Nouvel article face à l'article gardé : candidats lus autour d'un point tiré au hasard dans chaque fourchette
 * de vues (la voulue pour la série, puis les élargies), au-dessus et en dessous ; `pickChallenger` décide
 * (50 % plus vu, fourchette la plus serrée possible, jamais à moins de ×1,05).
 */
async function challengerFor(
  ctx: Ctx,
  db: DbOrTx,
  userId: string,
  day: string,
  season: number,
  hide: boolean,
  keptViews: number,
  streak: number,
) {
  const candidates = new Map<number, PoolRow>();
  for (const band of hlWidenedBands(streak)) {
    for (const higher of [true, false]) {
      const range = hlViewRange(keptViews, band, higher);
      if (range.from > range.to) continue;
      // Point de départ tiré en échelle logarithmique : toute la fourchette a sa chance.
      const to = Math.min(range.to, 1e12);
      const pivot = Math.floor(range.from * (to / Math.max(1, range.from)) ** (ctx.random(1_000) / 1_000));
      for (const [lo, hi] of [
        [pivot, to],
        [range.from, pivot],
      ] as const) {
        const rows = await poolRows(
          db,
          userId,
          day,
          season,
          hide,
          sql`c.views_12m between ${lo} and ${hi}`,
          sql`c.views_12m, c.id`,
        );
        for (const r of rows) candidates.set(r.id, r);
        if (rows.length) break;
      }
    }
    const pick = pickChallenger(keptViews, [...candidates.values()], streak, ctx.random);
    if (pick) return pick;
  }
  return null;
}

/** Article tel que montré au joueur : titre, image, description courte. Ni rareté, ni vues, ni identifiant. */
async function articleOf(db: DbOrTx, season: number, cardId: number): Promise<HlArticleDTO & { views: number }> {
  const [r] = await db.execute<{
    title: string;
    views_12m: string;
    thumb_url: string | null;
    description: string | null;
  }>(sql`
    select c.title, c.views_12m, s.thumb_url, s.description
    from cards c left join wiki_summaries s on s.page_id = c.id
    where c.season = ${season} and c.id = ${cardId}
  `);
  return {
    title: r?.title ?? "?",
    thumbUrl: r?.thumb_url ?? null,
    description: r?.description ?? null,
    views: Number(r?.views_12m ?? 0),
  };
}

const hidden = ({ title, thumbUrl, description }: HlArticleDTO): HlArticleDTO => ({ title, thumbUrl, description });

async function pairOf(db: DbOrTx, run: Run, now: Date): Promise<HlPairDTO> {
  const [kept, challenger] = await Promise.all([
    articleOf(db, run.season, run.keptCardId),
    articleOf(db, run.season, run.challengerCardId),
  ]);
  return {
    tryNo: run.tryNo,
    step: run.step,
    streak: run.streak,
    kept: hidden(kept),
    challenger: hidden(challenger),
    deadline: run.deadline.toISOString(),
    // Temps restant vu du serveur : le chrono du navigateur s'y cale (horloges décalées).
    msLeft: Math.max(0, run.deadline.getTime() - now.getTime()),
    durationMs: HL_CHOICE_MS,
    reward: hlReward(run.streak),
    nextReward: hlReward(run.streak + 1),
  };
}

async function hideOf(db: DbOrTx, userId: string) {
  const [p] = await db
    .select({ hide: schema.players.hideArthropods })
    .from(schema.players)
    .where(eq(schema.players.userId, userId));
  return !!p?.hide;
}

/**
 * Termine un essai verrouillé (mauvaise réponse, temps écoulé, plus d'article possible) : PW selon la série,
 * versés dans la même transaction que le passage à « over ». Le verrou de la ligne garantit un seul versement.
 */
async function finish(ctx: Ctx, tx: Tx, run: Run, reason: "wrong" | "timeout" | "exhausted") {
  const reward = hlReward(run.streak);
  const p = await lockPlayer(tx, run.userId);
  await tx
    .update(runs)
    .set({ status: "over", endReason: reason, reward, finishedAt: ctx.now() })
    .where(eq(runs.id, run.id));
  if (reward) await movePw(tx, p, reward, "higher_lower", `hl:${run.id}`);
  return { player: p, reward, streak: run.streak };
}

/** Après la fin d'un essai : solde poussé, progression (succès, quêtes, passe). */
async function afterFinish(
  ctx: Ctx,
  userId: string,
  done: { player: Parameters<typeof pushWallet>[1]; streak: number },
) {
  await afterCommit(ctx, async () => {
    pushWallet(ctx, done.player);
    void emit(ctx, userId, { type: "hl_finished", streak: done.streak });
  });
}

/** Essai en cours dont l'échéance est passée : il se termine en défaite (quitter la page ne met pas en pause). */
async function expireIfDue(ctx: Ctx, userId: string) {
  const [late] = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.status, "playing")));
  if (late) await expireRun(ctx, late.id);
}

/** Termine un essai échu (job de rattrapage chaque minute, ou lecture de l'état par le joueur). Idempotent. */
export async function expireRun(ctx: Ctx, runId: number) {
  const done = await ctx.db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
    if (!run || run.status !== "playing" || !hlExpired(run.deadline, ctx.now())) return null;
    return { userId: run.userId, ...(await finish(ctx, tx, run, "timeout")) };
  });
  if (done) await afterFinish(ctx, done.userId, done);
}

/** Job : essais échus de tous les joueurs (filet de sécurité, la récompense ne dépend pas d'un retour). */
export async function sweepHigherLower(ctx: Ctx) {
  const due = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.status, "playing"),
        sql`${runs.deadline} < ${new Date(ctx.now().getTime() - 2_000).toISOString()}::timestamptz`,
      ),
    );
  for (const r of due) await expireRun(ctx, r.id);
}

/** État du jour : essais joués, essai en cours, résumé et texte à partager une fois les 3 essais finis. */
export async function hlState(ctx: Ctx, userId: string): Promise<HlStateDTO> {
  await expireIfDue(ctx, userId);
  const now = ctx.now();
  const day = parisDay(now);
  const today = await ctx.db
    .select()
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.day, day)))
    .orderBy(runs.tryNo);
  const playing = (
    await ctx.db
      .select()
      .from(runs)
      .where(and(eq(runs.userId, userId), eq(runs.status, "playing")))
      .limit(1)
  )[0];
  const [stats] = await ctx.db.execute<{ best: number | null; wins: number | null }>(sql`
    select max(streak)::int as best, sum(streak)::int as wins from hl_runs where user_id = ${userId} and status = 'over'
  `);
  const finished = today.filter((r) => r.status === "over");
  const used = today.length;
  const best = stats?.best ?? 0;
  const allDone = used >= HL_TRIES_PER_DAY && !playing;
  return {
    day,
    maxTries: HL_TRIES_PER_DAY,
    triesLeft: Math.max(0, HL_TRIES_PER_DAY - used),
    current: playing ? await pairOf(ctx.db, playing, now) : null,
    runs: finished.map((r) => ({ tryNo: r.tryNo, streak: r.streak, reward: r.reward, endReason: r.endReason })),
    todayBest: Math.max(0, ...finished.map((r) => r.streak)),
    best,
    totalWins: stats?.wins ?? 0,
    earnedToday: finished.reduce((s, r) => s + r.reward, 0),
    resetsAt: nextParisMidnight(now).toISOString(),
    share: allDone
      ? hlShareText(
          day,
          finished.map((r) => r.streak),
          best,
        )
      : null,
  };
}

/**
 * Nouvel essai (3 par jour de Paris) : premier article au hasard, nouvel article à ×2 à ×20, échéance dans 15 s.
 * Joueur verrouillé : deux clics simultanés ne lancent qu'un essai. Un essai déjà en cours est simplement repris.
 */
export async function hlStart(ctx: Ctx, userId: string): Promise<HlStateDTO> {
  await expireIfDue(ctx, userId);
  const now = ctx.now();
  const day = parisDay(now);
  await ctx.db.transaction(async (tx) => {
    await lockPlayer(tx, userId);
    const [playing] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.userId, userId), eq(runs.status, "playing")));
    if (playing) return;
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(runs)
      .where(and(eq(runs.userId, userId), eq(runs.day, day)));
    if ((count?.n ?? 0) >= HL_TRIES_PER_DAY)
      throw conflict("hl_no_tries", "Tu as joué tes 3 essais du jour : reviens demain !");
    const season = await activeSeason(tx);
    const hide = await hideOf(tx, userId);
    const kept = await firstArticle(ctx, tx, userId, day, season, hide);
    const challenger = kept && (await challengerFor(ctx, tx, userId, day, season, hide, kept.views, 0));
    if (!kept || !challenger) throw conflict("hl_empty", "Plus d'article à comparer aujourd'hui : reviens demain !");
    await tx.insert(schema.hlSeen).values([
      { userId, day, cardId: kept.id },
      { userId, day, cardId: challenger.id },
    ]);
    await tx.insert(runs).values({
      userId,
      day,
      tryNo: (count?.n ?? 0) + 1,
      season,
      keptCardId: kept.id,
      challengerCardId: challenger.id,
      deadline: new Date(now.getTime() + HL_CHOICE_MS),
    });
  });
  return hlState(ctx, userId);
}

/**
 * Réponse du joueur pour la paire `step` : « kept » (l'article resté à l'écran) ou « challenger » (le nouveau).
 * Bonne réponse avant l'échéance (+1 s de marge) : série +1, le plus vu reste, un nouvel article arrive. Sinon
 * l'essai s'arrête et paie sa série. Les vues ne partent qu'avec la réponse. Ligne de l'essai verrouillée et
 * `step` vérifié : une réponse en double ou concurrente ne compte jamais deux fois ni pour la paire suivante.
 */
export async function hlAnswer(
  ctx: Ctx,
  userId: string,
  step: number,
  pick: "kept" | "challenger",
): Promise<HlAnswerDTO> {
  const now = ctx.now();
  const res = await ctx.db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.userId, userId), eq(runs.status, "playing")))
      .orderBy(desc(runs.id))
      .limit(1)
      .for("update");
    if (!run) throw conflict("hl_no_run", "Aucun essai en cours.");
    if (run.step !== step) throw conflict("hl_stale", "Cette paire est déjà jouée.");
    const [kept, challenger] = await Promise.all([
      articleOf(tx, run.season, run.keptCardId),
      articleOf(tx, run.season, run.challengerCardId),
    ]);
    const reveal = {
      kept: { title: kept.title, views: kept.views },
      challenger: { title: challenger.title, views: challenger.views },
    };
    const timeout = hlExpired(run.deadline, now);
    const [picked, other] = pick === "kept" ? [kept, challenger] : [challenger, kept];
    const correct = !timeout && hlCorrect(picked.views, other.views);
    if (!correct) {
      const done = await finish(ctx, tx, run, timeout ? "timeout" : "wrong");
      return { reveal, correct, timeout, run, done };
    }
    // Bonne réponse : l'article choisi (le plus vu) reste, un nouveau arrive en face.
    const streak = run.streak + 1;
    const newKept = pick === "kept" ? run.keptCardId : run.challengerCardId;
    const hide = await hideOf(tx, userId);
    const next = await challengerFor(ctx, tx, userId, run.day, run.season, hide, picked.views, streak);
    if (!next) {
      const done = await finish(ctx, tx, { ...run, streak }, "exhausted");
      await tx.update(runs).set({ streak }).where(eq(runs.id, run.id));
      return { reveal, correct, timeout, run: { ...run, streak }, done };
    }
    await tx.insert(schema.hlSeen).values({ userId, day: run.day, cardId: next.id }).onConflictDoNothing();
    const [updated] = await tx
      .update(runs)
      .set({
        streak,
        step: run.step + 1,
        keptCardId: newKept,
        challengerCardId: next.id,
        // La paire suivante s'affiche après la révélation des vues : son chrono part à ce moment-là.
        deadline: new Date(now.getTime() + HL_REVEAL_MS + HL_CHOICE_MS),
      })
      .where(eq(runs.id, run.id))
      .returning();
    return { reveal, correct, timeout, run: updated!, done: null };
  });
  if (res.done) await afterFinish(ctx, userId, res.done);
  return {
    correct: res.correct,
    timeout: res.timeout,
    reveal: res.reveal,
    streak: res.done ? res.done.streak : res.run.streak,
    reward: res.done ? res.done.reward : null,
    next: res.done ? null : await pairOf(ctx.db, res.run, ctx.now()),
    state: await hlState(ctx, userId),
  };
}

/** Essais restants aujourd'hui (pastille du menu). */
export async function hlTriesLeft(ctx: Ctx, userId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.day, parisDay(ctx.now()))));
  return Math.max(0, HL_TRIES_PER_DAY - (row?.n ?? 0));
}
