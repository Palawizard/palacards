import { and, eq, isNull, schema, sql } from "@palacards/db";
import {
  addDays,
  ARTICLE_HINT_CATEGORIES_AFTER,
  ARTICLE_HINT_DESCRIPTION_AFTER,
  ARTICLE_HINT_LETTER_AFTER,
  ARTICLE_MAX_GUESSES,
  ARTICLE_SEARCH_MAX_LENGTH,
  articleCategory,
  articleHints,
  articleImageWidth,
  articleReward,
  attrValues,
  ATTR_KEYS,
  baseTitle,
  compareAttrs,
  descriptionType,
  hintCategories,
  maskedDescription,
  parisDay,
  seededRandom,
  shareGrid,
  titlePattern,
  unusableQuizImage,
  type ArticleAttrs,
  type ArticleCategory,
  type AttrComparison,
  type Rarity,
} from "@palacards/game";
import type { ArticleGuessDTO, ArticleSearchItemDTO, CardDTO, DailyArticleDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { conflict, GameError, notFound } from "../errors.js";
import { afterCommit } from "./notifications.js";
import { activeSeason, lockPlayer, movePw, pushWallet } from "./players.js";
import { decodeImage, pixelate, pixelatableUrl, type Bitmap } from "./pixelate.js";
import { emit } from "./progression.js";
import { withTimeout } from "./quiz.js";
import { nextParisMidnight } from "./wheel.js";
import { articleUrl } from "./wiki.js";

type ArticleRow = typeof schema.dailyArticles.$inferSelect;
type GuessRow = typeof schema.dailyGuesses.$inferSelect;
type Entry = GuessRow["entries"][number];

/** Réponses possibles : Ultra rares et Légendaires de la saison (très lues, devinables). */
const ANSWER_RARITIES = ["UR", "L"] as const;
/** Essais possibles : Super rares et mieux de la saison (≈ 50 000 articles). */
const GUESS_RARITIES = ["SR", "UR", "L"] as const;
/** Candidats examinés pour la réponse du jour (attributs complets, image). */
const CANDIDATES = 12;
/** Suggestions de l'autocomplétion. */
const SEARCH_LIMIT = 8;

const inList = (list: readonly string[]) =>
  sql.join(
    list.map((r) => sql`${r}::rarity`),
    sql`, `,
  );

// ---------------------------------------------------------------------------
// Attributs d'un article
// ---------------------------------------------------------------------------

/**
 * Attributs d'articles (catégorie et type d'après la description courte, pays et année d'après Wikidata,
 * rareté et vues de la carte), chargés à la demande dans la limite de `waitMs`. Absents : « ? ».
 */
async function attrsOf(
  ctx: Ctx,
  cards: { cardId: number; title: string; rarity: Rarity; views: number }[],
  waitMs: number,
): Promise<Map<number, ArticleAttrs & { description: string | null; thumbUrl: string | null }>> {
  const ids = cards.map((c) => c.cardId);
  await withTimeout(
    Promise.all([ctx.wiki.load(cards, undefined, { fresh: true }), ctx.wiki.loadAttributes(ids)]),
    waitMs,
    null,
  );
  const [summaries, attrs] = await Promise.all([ctx.wiki.summaries(ids), ctx.wiki.attributes(ids)]);
  return new Map(
    cards.map((c) => {
      const s = summaries.get(c.cardId);
      const a = attrs.get(c.cardId);
      const description = s?.description ?? null;
      const category: ArticleCategory | null =
        description || a?.human ? articleCategory(description, { human: a?.human }) : null;
      return [
        c.cardId,
        {
          category,
          type: descriptionType(description),
          countryId: a?.countryId ?? null,
          country: a?.country ?? null,
          continents: a?.continents ?? [],
          year: a?.year ?? null,
          rarity: c.rarity,
          views: c.views,
          description,
          thumbUrl: s?.thumbUrl ?? null,
        },
      ];
    }),
  );
}

const strip = <T extends ArticleAttrs>({ category, type, countryId, country, continents, year, rarity, views }: T) => ({
  category,
  type,
  countryId,
  country,
  continents,
  year,
  rarity,
  views,
});

/** Vignette utilisable pour l'image pixelisée (photo JPEG ou PNG, pas un logo ou une image par défaut). */
const usableImage = (url: string | null) => (url && !unusableQuizImage(url) && pixelatableUrl(url) ? url : null);

// ---------------------------------------------------------------------------
// Réponse du jour
// ---------------------------------------------------------------------------

/**
 * Article du jour : une Ultra rare ou une Légendaire de la saison, tirée d'après le jour, jamais deux fois, pas
 * de la même catégorie que la veille. Seulement un article dont la catégorie, le pays et l'année sont connus,
 * avec une image si possible ; sinon on relâche ces exigences une à une. Figé en base à la première demande.
 * Un article du jour de l'ancien format (jour de la mise à jour) est converti : même réponse, ses attributs.
 */
export async function dailyArticle(ctx: Ctx, day = parisDay(ctx.now())): Promise<ArticleRow> {
  const [existing] = await ctx.db.select().from(schema.dailyArticles).where(eq(schema.dailyArticles.day, day));
  if (existing?.format === 2) return existing;
  if (existing) {
    const [c] = await ctx.db.execute<{ views_12m: string }>(
      sql`select views_12m from cards where season = ${existing.season} and id = ${existing.cardId}`,
    );
    const a = (
      await attrsOf(
        ctx,
        [{ cardId: existing.cardId, title: existing.title, rarity: existing.rarity, views: Number(c?.views_12m ?? 0) }],
        6_000,
      )
    ).get(existing.cardId)!;
    await ctx.db
      .update(schema.dailyArticles)
      .set({ format: 2, attrs: strip(a), description: a.description, imageUrl: usableImage(a.thumbUrl) })
      .where(and(eq(schema.dailyArticles.day, day), eq(schema.dailyArticles.format, 1)));
    const [row] = await ctx.db.select().from(schema.dailyArticles).where(eq(schema.dailyArticles.day, day));
    return row!;
  }
  const season = await activeSeason(ctx.db);
  const key = seededRandom(`article:${day}`)();
  const pick = (from: number) =>
    ctx.db.execute<{ id: string; title: string; rarity: Rarity; views_12m: string }>(sql`
    select id, title, rarity, views_12m from cards
    where season = ${season} and rarity in (${inList(ANSWER_RARITIES)}) and rand_key >= ${from}
      and id not in (select card_id from daily_articles)
    order by rand_key limit ${CANDIDATES}
  `);
  let rows = [...(await pick(key))];
  if (rows.length < CANDIDATES)
    rows = [...rows, ...(await pick(0))]
      .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
      .slice(0, CANDIDATES);
  if (!rows.length) throw conflict("no_article", "Aucun article disponible aujourd'hui.");
  const attrs = await attrsOf(
    ctx,
    rows.map((r) => ({ cardId: Number(r.id), title: r.title, rarity: r.rarity, views: Number(r.views_12m) })),
    8_000,
  );
  const [yesterday] = await ctx.db
    .select({ attrs: schema.dailyArticles.attrs })
    .from(schema.dailyArticles)
    .where(eq(schema.dailyArticles.day, addDays(day, -1)));
  const prevCategory = yesterday?.attrs?.category ?? null;
  const a = (r: (typeof rows)[number]) => attrs.get(Number(r.id))!;
  const complete = (r: (typeof rows)[number]) => !!a(r).category && !!a(r).countryId && a(r).year !== null;
  const fresh = (r: (typeof rows)[number]) => a(r).category !== prevCategory;
  const chosen =
    rows.find((r) => complete(r) && fresh(r) && usableImage(a(r).thumbUrl)) ??
    rows.find((r) => complete(r) && fresh(r)) ??
    rows.find((r) => !!a(r).category && fresh(r)) ??
    rows.find(fresh) ??
    rows[0]!;
  const ca = a(chosen);
  await ctx.db
    .insert(schema.dailyArticles)
    .values({
      day,
      cardId: Number(chosen.id),
      season,
      title: chosen.title,
      rarity: chosen.rarity,
      clues: [],
      format: 2,
      attrs: strip(ca),
      description: ca.description,
      imageUrl: usableImage(ca.thumbUrl),
    })
    .onConflictDoNothing();
  const [row] = await ctx.db.select().from(schema.dailyArticles).where(eq(schema.dailyArticles.day, day));
  return row!;
}

/** Dernier échec du chargement des catégories (par jour) : on ne réessaie qu'après CATEGORIES_RETRY_MS. */
let categoriesFailed: { day: string; at: number } | null = null;
const CATEGORIES_RETRY_MS = 10 * 60_000;

/**
 * Catégories Wikipédia de la réponse montrées en indice : chargées une fois, filtrées (`hintCategories`) puis
 * figées avec l'article du jour, les mêmes pour tous. Wikipédia indisponible : aucune pour l'instant.
 */
async function answerCategories(ctx: Ctx, a: ArticleRow): Promise<string[]> {
  if (a.categories) return a.categories;
  const now = ctx.now().getTime();
  if (categoriesFailed?.day === a.day && now - categoriesFailed.at < CATEGORIES_RETRY_MS) return [];
  const raw = await withTimeout(ctx.wiki.pageCategories(a.cardId), 4_000, null);
  if (!raw) {
    categoriesFailed = { day: a.day, at: now };
    return [];
  }
  await ctx.db
    .update(schema.dailyArticles)
    .set({ categories: hintCategories(raw, a.title) })
    .where(and(eq(schema.dailyArticles.day, a.day), isNull(schema.dailyArticles.categories)));
  const [row] = await ctx.db
    .select({ categories: schema.dailyArticles.categories })
    .from(schema.dailyArticles)
    .where(eq(schema.dailyArticles.day, a.day));
  return row?.categories ?? [];
}

async function answerCard(ctx: Ctx, a: ArticleRow): Promise<CardDTO> {
  const [row] = await ctx.db.execute<{
    atk: number;
    def: number;
    views_12m: string;
    thumb_url: string | null;
    page_url: string | null;
  }>(sql`
    select c.atk, c.def, c.views_12m, s.thumb_url, s.page_url from cards c
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
    views12m: Number(row?.views_12m ?? 0),
    thumbUrl: row?.thumb_url ?? null,
    pageUrl: row?.page_url ?? articleUrl(a.title),
  };
}

// ---------------------------------------------------------------------------
// État d'une partie
// ---------------------------------------------------------------------------

const guessDTO = (e: Entry): ArticleGuessDTO => {
  const values = attrValues(e.attrs);
  const cmp = e.cmp as AttrComparison;
  return {
    cardId: e.cardId,
    title: e.title,
    cells: Object.fromEntries(
      ATTR_KEYS.map((k) => [k, { value: values[k], state: cmp[k].state, arrow: cmp[k].arrow }]),
    ) as ArticleGuessDTO["cells"],
  };
};

/** Partie finie avec l'ancien format (titres tapés) : le jour de la mise à jour, on ne la rejoue pas. */
const legacyFinished = (g: GuessRow | undefined) => !!g?.finishedAt && g.entries.length === 0 && g.guesses.length > 0;

/** État de l'article du jour pour un joueur : essais, indices, image, et la réponse une fois fini. */
export async function articleState(ctx: Ctx, userId: string): Promise<DailyArticleDTO> {
  const a = await dailyArticle(ctx);
  const [g] = await ctx.db
    .select()
    .from(schema.dailyGuesses)
    .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, a.day)));
  const entries = g?.entries ?? [];
  const finished = !!g?.finishedAt;
  const legacy = legacyFinished(g);
  const used = legacy ? g!.guesses.length : entries.length;
  const hints = articleHints(entries.length, finished);
  const [num] = await ctx.db.execute<{ number: number }>(
    sql`select count(*)::int as number from daily_articles where day <= ${a.day}`,
  );
  let stats: DailyArticleDTO["stats"] = null;
  if (finished) {
    const rows = await ctx.db.execute<{ found: boolean; n: number }>(sql`
      select found, (case when jsonb_array_length(entries) > 0 then jsonb_array_length(entries)
                          else jsonb_array_length(guesses) end)::int as n
      from daily_guesses where day = ${a.day} and finished_at is not null
    `);
    const distribution = Array.from({ length: ARTICLE_MAX_GUESSES }, () => 0);
    for (const r of rows) if (r.found && r.n >= 1 && r.n <= ARTICLE_MAX_GUESSES) distribution[r.n - 1]!++;
    stats = { played: rows.length, found: rows.filter((r) => r.found).length, distribution };
  }
  const answerAttrs = a.attrs;
  const categories = await answerCategories(ctx, a);
  const firstLetter = [...baseTitle(a.title)].find((ch) => /[\p{L}\p{N}]/u.test(ch))?.toUpperCase() ?? null;
  return {
    day: a.day,
    number: num?.number ?? 1,
    maxGuesses: ARTICLE_MAX_GUESSES,
    guesses: entries.map(guessDTO),
    pattern: titlePattern(a.title, finished ? "all" : hints.firstLetter ? "first" : "none"),
    hints: {
      categories: categories.slice(0, hints.categories),
      description: hints.description ? maskedDescription(a.description, a.title) : null,
      firstLetter: hints.firstLetter ? firstLetter : null,
    },
    hintsAfter: {
      categories: ARTICLE_HINT_CATEGORIES_AFTER.slice(0, categories.length),
      description: ARTICLE_HINT_DESCRIPTION_AFTER,
      firstLetter: ARTICLE_HINT_LETTER_AFTER,
    },
    image: !!a.imageUrl,
    imageWidth: articleImageWidth(entries.length, finished),
    found: !!g?.found,
    finished,
    reward: g?.reward ?? 0,
    nextReward: finished ? 0 : articleReward(entries.length + 1),
    answer: finished ? await answerCard(ctx, a) : null,
    answerCells: finished && answerAttrs ? attrValues(answerAttrs) : null,
    share:
      finished && !legacy
        ? shareGrid(
            entries.map((e) => e.cmp as AttrComparison),
            !!g?.found,
            num?.number ?? 1,
          )
        : null,
    stats,
    legacy: legacy ? { guesses: g!.guesses.slice(0, used) } : null,
    nextAt: nextParisMidnight(ctx.now()).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Essais
// ---------------------------------------------------------------------------

/**
 * Un essai à l'article du jour : un article du jeu (Super rare ou mieux), comparé à la réponse sur ses
 * attributs (calculés maintenant, figés avec l'essai). Une transaction, joueur verrouillé : la partie se termine
 * sur la bonne réponse (PW selon le nombre d'essais) ou au huitième essai raté.
 */
export async function guessArticle(ctx: Ctx, userId: string, cardId: number): Promise<DailyArticleDTO> {
  const a = await dailyArticle(ctx);
  const [card] = await ctx.db.execute<{ id: string; title: string; rarity: Rarity; views_12m: string }>(sql`
    select id, title, rarity, views_12m from cards
    where season = ${a.season} and id = ${cardId} and rarity in (${inList(GUESS_RARITIES)})
  `);
  if (!card) throw notFound("Cet article n'est pas dans le jeu : choisis-en un dans la liste.");
  const [before] = await ctx.db
    .select()
    .from(schema.dailyGuesses)
    .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, a.day)));
  if (before?.finishedAt) throw conflict("article_done", "Tu as déjà joué l'article du jour : reviens demain !");
  if (before?.entries.some((e) => e.cardId === cardId))
    throw conflict("already_guessed", "Tu as déjà proposé cet article.");
  const found = cardId === a.cardId;
  // La réponse elle-même : ses attributs figés (identiques) ; sinon ceux de l'article proposé.
  const attrs = found
    ? a.attrs!
    : strip(
        (
          await attrsOf(ctx, [{ cardId, title: card.title, rarity: card.rarity, views: Number(card.views_12m) }], 3_500)
        ).get(cardId)!,
      );
  const cmp = compareAttrs(attrs, a.attrs!);
  const res = await ctx.db.transaction(async (tx) => {
    const player = await lockPlayer(tx, userId);
    await tx.insert(schema.dailyGuesses).values({ userId, day: a.day }).onConflictDoNothing();
    const [g] = await tx
      .select()
      .from(schema.dailyGuesses)
      .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, a.day)))
      .for("update");
    if (g!.finishedAt) throw conflict("article_done", "Tu as déjà joué l'article du jour : reviens demain !");
    if (g!.entries.some((e) => e.cardId === cardId))
      throw conflict("already_guessed", "Tu as déjà proposé cet article.");
    const entries = [...g!.entries, { cardId, title: card.title, attrs, cmp }];
    const over = found || entries.length >= ARTICLE_MAX_GUESSES;
    const reward = articleReward(entries.length, found);
    await tx
      .update(schema.dailyGuesses)
      .set({ entries, found, reward, finishedAt: over ? ctx.now() : null })
      .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, a.day)));
    if (reward) await movePw(tx, player, reward, "daily_article", a.day);
    return { player, over, count: entries.length, reward };
  });
  await afterCommit(ctx, async () => {
    if (res.reward) pushWallet(ctx, res.player);
    if (res.over) void emit(ctx, userId, { type: "article_played", found, guesses: res.count });
  });
  return articleState(ctx, userId);
}

/**
 * Autocomplétion : articles Super rares et mieux de la saison dont le titre contient la recherche (sans
 * accents) : le titre exact d'abord, puis ceux qui commencent par elle, puis les plus lus. Les attributs des premiers se chargent
 * en arrière-plan : l'essai sera rapide.
 */
export async function searchArticles(ctx: Ctx, raw: string): Promise<ArticleSearchItemDTO[]> {
  const q = raw.trim().replace(/\s+/g, " ").slice(0, ARTICLE_SEARCH_MAX_LENGTH);
  if (q.length < 2) return [];
  const season = await activeSeason(ctx.db);
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = 2000`);
    return tx.execute<{ id: string; title: string; rarity: Rarity }>(sql`
      select id, title, rarity from cards
      where season = ${season} and rarity in (${inList(GUESS_RARITIES)})
        and search_title like lower(f_unaccent(${`%${escaped}%`}))
      order by (search_title = lower(f_unaccent(${q}))) desc,
               (search_title like lower(f_unaccent(${`${escaped}%`}))) desc,
               views_12m desc, id
      limit ${SEARCH_LIMIT}
    `);
  });
  const items = rows.map((r) => ({ cardId: Number(r.id), title: r.title, rarity: r.rarity }));
  const top = items.slice(0, 3);
  if (top.length) {
    void ctx.wiki.load(top).catch(() => {});
    void ctx.wiki.loadAttributes(top.map((t) => t.cardId)).catch(() => {});
  }
  return items;
}

// ---------------------------------------------------------------------------
// Image pixelisée
// ---------------------------------------------------------------------------

/** Image décodée de la réponse du jour, gardée en mémoire (une par jour). */
let decoded: { day: string; img: Bitmap | null; original: { body: Buffer; type: string } | null } | null = null;

async function answerBitmap(ctx: Ctx, a: ArticleRow) {
  if (decoded?.day === a.day) return decoded;
  let original: { body: Buffer; type: string } | null = null;
  try {
    const res = await fetch(a.imageUrl!, {
      headers: { "User-Agent": ctx.config.WIKIMEDIA_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.startsWith("image/")) original = { body: Buffer.from(await res.arrayBuffer()), type };
  } catch (err) {
    ctx.log.warn({ err }, "image de l'article du jour indisponible");
  }
  const img = original ? decodeImage(original.body, original.type) : null;
  // Échec réseau : pas mis en cache, on réessaiera à la prochaine demande.
  if (img) decoded = { day: a.day, img, original };
  return { day: a.day, img, original };
}

/**
 * Image de la réponse vue par un joueur : quelques pixels au début, un peu plus nette à chaque essai, l'image
 * entière une fois sa partie finie. L'URL d'origine ne quitte jamais le serveur avant la fin.
 */
export async function articleImage(ctx: Ctx, userId: string): Promise<{ body: Buffer; type: string }> {
  const a = await dailyArticle(ctx);
  if (!a.imageUrl) throw notFound("Pas d'image pour l'article du jour.");
  const [g] = await ctx.db
    .select()
    .from(schema.dailyGuesses)
    .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, a.day)));
  const width = articleImageWidth(g?.entries.length ?? 0, !!g?.finishedAt);
  const { img, original } = await answerBitmap(ctx, a);
  if (!img || !original) throw new GameError(502, "image_unavailable", "Image indisponible pour l'instant.");
  if (width === null) return original;
  return { body: pixelate(img, width), type: "image/png" };
}

/** L'article du jour n'a pas encore été joué jusqu'au bout (pastille du menu). */
export async function articleReady(ctx: Ctx, userId: string): Promise<boolean> {
  const [g] = await ctx.db
    .select({ finishedAt: schema.dailyGuesses.finishedAt })
    .from(schema.dailyGuesses)
    .where(and(eq(schema.dailyGuesses.userId, userId), eq(schema.dailyGuesses.day, parisDay(ctx.now()))));
  return !g?.finishedAt;
}
