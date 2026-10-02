import { and, eq, schema, sql } from "@palacards/db";
import {
  ARTICLE_GUESS_MAX_LENGTH,
  ARTICLE_MAX_GUESSES,
  articleReward,
  buildClues,
  isCorrectGuess,
  parisDay,
  seededRandom,
  shareLine,
  titlePattern,
  type Rarity,
} from "@palacards/game";
import type { CardDTO, DailyArticleDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict } from "../errors.js";
import { afterCommit } from "./notifications.js";
import { activeSeason, lockPlayer, movePw, pushWallet } from "./players.js";
import { emit } from "./progression.js";
import { withTimeout } from "./quiz.js";
import { nextParisMidnight } from "./wheel.js";
import { articleUrl } from "./wiki.js";

type ArticleRow = typeof schema.dailyArticles.$inferSelect;

/** Candidats essayés pour trouver un article avec un résumé (indices plus riches). */
const CANDIDATES = 6;

/**
 * Article du jour : une Ultra rare ou une Légendaire de la saison (donc un article très lu, devinable),
 * tirée d'après le jour, jamais deux fois. Figé en base à la première demande, indices compris.
 */
export async function dailyArticle(ctx: Ctx, day = parisDay(ctx.now())): Promise<ArticleRow> {
  const [existing] = await ctx.db.select().from(schema.dailyArticles).where(eq(schema.dailyArticles.day, day));
  if (existing) return existing;
  const season = await activeSeason(ctx.db);
  const key = seededRandom(`article:${day}`)();
  const pick = (from: number) =>
    ctx.db.execute<{ id: string; title: string; rarity: Rarity; atk: number; def: number }>(sql`
    select id, title, rarity, atk, def from cards
    where season = ${season} and rarity in ('UR', 'L') and rand_key >= ${from}
      and id not in (select card_id from daily_articles)
    order by rand_key limit ${CANDIDATES}
  `);
  let rows = [...(await pick(key))];
  if (rows.length < CANDIDATES)
    rows = [...rows, ...(await pick(0))]
      .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
      .slice(0, CANDIDATES);
  if (!rows.length) throw conflict("no_article", "Aucun article disponible aujourd'hui.");
  const cards = rows.map((r) => ({ cardId: Number(r.id), title: r.title }));
  await withTimeout(ctx.wiki.load(cards, undefined, { fresh: true }), 6_000, []);
  const summaries = await ctx.wiki.summaries(cards.map((c) => c.cardId));
  const chosen = rows.find((r) => summaries.get(Number(r.id))?.extract) ?? rows[0]!;
  const s = summaries.get(Number(chosen.id));
  const clues = buildClues({
    title: chosen.title,
    rarity: chosen.rarity,
    atk: chosen.atk,
    def: chosen.def,
    description: s?.description ?? null,
    extract: s?.extract ?? null,
    thumbUrl: s?.thumbUrl ?? null,
  });
  await ctx.db
    .insert(schema.dailyArticles)
    .values({ day, cardId: Number(chosen.id), season, title: chosen.title, rarity: chosen.rarity, clues })
    .onConflictDoNothing();
  const [row] = await ctx.db.select().from(schema.dailyArticles).where(eq(schema.dailyArticles.day, day));
  return row!;
}

async function answerCard(ctx: Ctx, a: ArticleRow): Promise<CardDTO> {
  const [row] = await ctx.db.execute<{
    atk: number;
    def: number;
    thumb_url: string | null;
    page_url: string | null;
  }>(sql`
    select c.atk, c.def, s.thumb_url, s.page_url from cards c
    left join wiki_summaries s on s.page_id = c.id
    where c.season = ${a.season} and c.id = ${a.cardId}
  `);
  return {
    instanceId: null,
    cardId: a.cardId,
    season: a.season,
    title: a.title,
    rarity: a.rarity,
    atk: row?.atk ?? 0,
    def: row?.def ?? 0,
    level: 1,
    thumbUrl: row?.thumb_url ?? null,
    pageUrl: row?.page_url ?? articleUrl(a.title),
  };
}

/** État de l'article du jour pour un joueur : indices dévoilés, essais, et la réponse une fois fini. */
export async function articleState(ctx: Ctx, userId: string): Promise<DailyArticleDTO> {
  const a = await dailyArticle(ctx);
  const [g] = await ctx.db
    .select()
    .from(schema.dailyGuesses)
    .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, a.day)));
  const guesses = g?.guesses ?? [];
  const finished = !!g?.finishedAt;
  const [stats] = await ctx.db.execute<{ played: number; found: number; number: number }>(sql`
    select count(*)::int as played, count(*) filter (where found)::int as found,
           (select count(*)::int from daily_articles where day <= ${a.day}) as number
    from daily_guesses where day = ${a.day} and jsonb_array_length(guesses) > 0
  `);
  const shown = finished ? a.clues.length : Math.min(a.clues.length, guesses.length + 1);
  const kinds = new Set(a.clues.slice(0, shown).map((c) => c.kind));
  const reveal = finished ? "all" : kinds.has("half") ? "half" : kinds.has("letters") ? "first" : "none";
  return {
    day: a.day,
    number: stats?.number ?? 1,
    maxGuesses: ARTICLE_MAX_GUESSES,
    guesses,
    clues: a.clues.slice(0, shown),
    pattern: titlePattern(a.title, reveal),
    found: !!g?.found,
    finished,
    reward: g?.reward ?? 0,
    nextReward: finished ? 0 : articleReward(guesses.length + 1),
    answer: finished ? await answerCard(ctx, a) : null,
    share: finished ? shareLine(guesses.length, !!g?.found) : null,
    stats: { played: stats?.played ?? 0, found: stats?.found ?? 0 },
    nextAt: nextParisMidnight(ctx.now()).toISOString(),
  };
}

/**
 * Un essai à l'article du jour. Une transaction (joueur verrouillé) : l'essai est ajouté, la partie se
 * termine sur la bonne réponse (PW selon le nombre d'essais) ou au sixième essai raté.
 */
export async function guessArticle(ctx: Ctx, userId: string, raw: string): Promise<DailyArticleDTO> {
  const guess = raw.trim().replace(/\s+/g, " ");
  if (!guess) throw badRequest("empty_guess", "Écris un titre d'article.");
  if (guess.length > ARTICLE_GUESS_MAX_LENGTH) throw badRequest("guess_too_long", "Ce titre est trop long.");
  const a = await dailyArticle(ctx);
  const res = await ctx.db.transaction(async (tx) => {
    const player = await lockPlayer(tx, userId);
    await tx.insert(schema.dailyGuesses).values({ userId, day: a.day }).onConflictDoNothing();
    const [g] = await tx
      .select()
      .from(schema.dailyGuesses)
      .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, a.day)))
      .for("update");
    if (g!.finishedAt) throw conflict("article_done", "Tu as déjà joué l'article du jour : reviens demain !");
    if (g!.guesses.some((x) => x.toLowerCase() === guess.toLowerCase()))
      throw conflict("already_guessed", "Tu as déjà proposé ce titre.");
    const guesses = [...g!.guesses, guess];
    const found = isCorrectGuess(guess, a.title);
    const over = found || guesses.length >= ARTICLE_MAX_GUESSES;
    const reward = found ? articleReward(guesses.length) : 0;
    await tx
      .update(schema.dailyGuesses)
      .set({ guesses, found, reward, finishedAt: over ? ctx.now() : null })
      .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, a.day)));
    if (reward) await movePw(tx, player, reward, "daily_article", a.day);
    return { player, over, found, count: guesses.length, reward };
  });
  await afterCommit(ctx, async () => {
    if (res.reward) pushWallet(ctx, res.player);
    if (res.over) void emit(ctx, userId, { type: "article_played", found: res.found, guesses: res.count });
  });
  return articleState(ctx, userId);
}

/** L'article du jour n'a pas encore été joué jusqu'au bout (pastille du menu). */
export async function articleReady(ctx: Ctx, userId: string): Promise<boolean> {
  const [g] = await ctx.db
    .select({ finishedAt: schema.dailyGuesses.finishedAt })
    .from(schema.dailyGuesses)
    .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, parisDay(ctx.now()))));
  return !g?.finishedAt;
}
