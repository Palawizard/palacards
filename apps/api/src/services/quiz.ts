import { sql } from "@palacards/db";
import {
  descriptionHead,
  makeBossQuestion,
  makeQuestion,
  seededRandom,
  type BossQuestion,
  type BossQuizArticle,
  type Question,
  type QuestionType,
  type QuizArticle,
  type Rarity,
} from "@palacards/game";
import type { Ctx } from "../context.js";
import type { DbOrTx } from "./players.js";

/** Préparation d'une question (résumés Wikipédia des leurres) : au-delà, repli sur ce qui est en cache. */
export const QUESTION_PREP_MS = 3_500;

type ArticleRow = {
  id: number;
  title: string;
  views_12m: string | number;
};

/** Articles aux titres voisins (trigrammes) : les leurres les plus crédibles. */
async function similarArticles(db: DbOrTx, season: number, cardId: number, title: string): Promise<ArticleRow[]> {
  const base = title.replace(/\s*\(.*\)\s*$/, "");
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = 1500`);
      await tx.execute(sql`set local pg_trgm.similarity_threshold = 0.35`);
      return tx.execute<ArticleRow>(sql`
        select id, title, views_12m from cards
        where search_title % lower(f_unaccent(${base})) and season = ${season} and id <> ${cardId}
        order by similarity(search_title, lower(f_unaccent(${base}))) desc
        limit 12
      `);
    });
  } catch {
    return []; // recherche trop lente ou indisponible : leurres au hasard seulement
  }
}

/** Articles au hasard de la même rareté (choisis par la graine). */
async function randomArticles(
  db: DbOrTx,
  seed: string,
  season: number,
  rarity: Rarity,
  cardId: number,
): Promise<ArticleRow[]> {
  const key = seededRandom(`${seed}:decoys`)();
  const rows = await db.execute<ArticleRow>(sql`
    (select id, title, views_12m from cards where season = ${season} and rarity = ${rarity}::rarity and rand_key >= ${key} and id <> ${cardId} order by rand_key limit 8)
    union all
    (select id, title, views_12m from cards where season = ${season} and rarity = ${rarity}::rarity and id <> ${cardId} order by rand_key limit 8)
  `);
  return rows;
}

export const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms).unref?.())]);

/**
 * Articles du même genre que la cible, pris dans les résumés déjà en cache : leur description commence par
 * le même mot (« chaîne… », « homme… », « commune… »). Ils donnent des leurres crédibles pour les
 * définitions, les images et « Qui suis-je ? » (une personne contre des personnes, pas contre un oiseau).
 */
async function sameKindArticles(
  db: DbOrTx,
  seed: string,
  season: number,
  cardId: number,
  head: string,
): Promise<ArticleRow[]> {
  return db.execute<ArticleRow>(sql`
    select c.id, c.title, c.views_12m
    from wiki_summaries w
    join cards c on c.season = ${season} and c.id = w.page_id
    where w.status = 'ok' and w.version >= 2 and w.page_id <> ${cardId} and w.description is not null
      and regexp_replace(lower(f_unaccent(split_part(trim(w.description), ' ', 1))), '[^a-z0-9]', '', 'g') = ${head}
    order by md5(w.page_id::text || ${seed})
    limit 30
  `);
}

export interface QuizTarget {
  /** Graine : la question ne dépend que d'elle, de la cible et des leurres. */
  seed: string;
  cardId: number;
  season: number;
  rarity: Rarity;
  /** Types de questions déjà posés, évités quand un autre est possible. */
  avoid?: QuestionType[];
  /** Articles que le joueur sait en jeu (ses autres cartes au boss) : seuls leurres des questions de reconnaissance. */
  known?: number[];
}

/**
 * Question de quiz sur l'article d'une carte (duels, boss du jour). Les résumés de la cible puis des leurres
 * (même genre, titres voisins, hasard) sont chargés à la demande, dans la limite de QUESTION_PREP_MS.
 */
export async function quizQuestion(ctx: Ctx, attack: QuizTarget): Promise<Question> {
  const seed = attack.seed;
  const [target] = await ctx.db.execute<ArticleRow>(
    sql`select id, title, views_12m from cards where season = ${attack.season} and id = ${attack.cardId}`,
  );
  const title = target?.title ?? "?";
  // Résumé de la cible d'abord : sa description donne le genre des leurres.
  await withTimeout(ctx.wiki.load([{ cardId: attack.cardId, title }], undefined, { fresh: true }), 2_000, []);
  const head = descriptionHead((await ctx.wiki.summaries([attack.cardId])).get(attack.cardId)?.description);
  const knownIds = (attack.known ?? []).filter((id) => id !== attack.cardId);
  const [sameKind, similar, random, known] = await Promise.all([
    head ? sameKindArticles(ctx.db, seed, attack.season, attack.cardId, head) : Promise.resolve([]),
    similarArticles(ctx.db, attack.season, attack.cardId, title),
    randomArticles(ctx.db, seed, attack.season, attack.rarity, attack.cardId),
    knownIds.length
      ? ctx.db.execute<ArticleRow>(
          sql`select id, title, views_12m from cards where season = ${attack.season} and id in (${sql.join(
            knownIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
      : Promise.resolve([] as ArticleRow[]),
  ]);
  const others = [...similar, ...random];
  const candidates = [...sameKind, ...others].filter(
    (r, i, all) => all.findIndex((x) => Number(x.id) === Number(r.id)) === i,
  );
  // Résumés des leurres pas encore en cache (titres voisins, hasard) : le temps du bouclier.
  const toLoad = [...known, ...others.slice(0, 8)].map((c) => ({ cardId: Number(c.id), title: c.title }));
  await withTimeout(ctx.wiki.load(toLoad, undefined, { fresh: true }), QUESTION_PREP_MS - 1_500, []);
  const summaries = await ctx.wiki.summaries([
    attack.cardId,
    ...known.map((c) => Number(c.id)),
    ...candidates.map((c) => Number(c.id)),
  ]);
  const article = (id: number, t: string, views: string | number): QuizArticle => {
    const s = summaries.get(id);
    return {
      cardId: id,
      title: t,
      views12m: Number(views),
      extract: s?.extract ?? null,
      description: s?.description ?? null,
      thumbUrl: s?.thumbUrl ?? null,
    };
  };
  const parisYear = Number(
    new Intl.DateTimeFormat("fr-FR", { year: "numeric", timeZone: "Europe/Paris" }).format(ctx.now()),
  );
  return makeQuestion(
    seed,
    article(attack.cardId, title, target?.views_12m ?? 0),
    candidates.map((c) => article(Number(c.id), c.title, c.views_12m)),
    {
      avoid: attack.avoid ?? [],
      maxYear: parisYear,
      known: attack.known ? known.map((c) => article(Number(c.id), c.title, c.views_12m)) : undefined,
    },
  );
}

const parisYear = (now: Date) =>
  Number(new Intl.DateTimeFormat("fr-FR", { year: "numeric", timeZone: "Europe/Paris" }).format(now));

export interface BossQuizTarget {
  /** Graine : joueur, jour, assaut et question (les leurres changent d'un jour et d'un joueur à l'autre). */
  seed: string;
  userId: string;
  cardId: number;
  season: number;
  rarity: Rarity;
  /** Types déjà posés dans cet assaut, évités quand un autre est possible. */
  avoid: string[];
  /** Article du boss (duels « le plus ancien », « le plus lu »). */
  boss: { cardId: number; season: number };
}

/**
 * Question du boss sur l'article d'une carte. Leurres du même genre, titres voisins et hasard, jamais les autres
 * cartes de l'assaut ; dates Wikidata de la cible et du boss pour l'année à taper et les duels ; variantes déjà
 * posées au joueur sur cet article évitées (historique).
 */
export async function bossQuestion(ctx: Ctx, t: BossQuizTarget): Promise<BossQuestion> {
  const rows = await ctx.db.execute<ArticleRow & { rarity: Rarity; season: number }>(sql`
    select id, title, views_12m, rarity, season from cards
    where (season = ${t.season} and id = ${t.cardId}) or (season = ${t.boss.season} and id = ${t.boss.cardId})
  `);
  const target = rows.find((r) => Number(r.id) === t.cardId && Number(r.season) === t.season);
  const bossRow = rows.find((r) => Number(r.id) === t.boss.cardId && Number(r.season) === t.boss.season);
  const title = target?.title ?? "?";
  const ids = [t.cardId, t.boss.cardId];
  await withTimeout(
    Promise.all([
      ctx.wiki.load([{ cardId: t.cardId, title }], undefined, { fresh: true }),
      ctx.wiki.loadAttributes(ids),
    ]),
    2_000,
    null,
  );
  const head = descriptionHead((await ctx.wiki.summaries([t.cardId])).get(t.cardId)?.description);
  const [sameKind, similar, random, history] = await Promise.all([
    head ? sameKindArticles(ctx.db, t.seed, t.season, t.cardId, head) : Promise.resolve([]),
    similarArticles(ctx.db, t.season, t.cardId, title),
    randomArticles(ctx.db, t.seed, t.season, t.rarity, t.cardId),
    ctx.db.execute<{ type: string; key: string; asked_at: Date | string }>(sql`
      select type, key, asked_at from boss_question_history where user_id = ${t.userId} and card_id = ${t.cardId}
    `),
  ]);
  const others = [...similar, ...random];
  const candidates = [...sameKind, ...others].filter(
    (r, i, all) => Number(r.id) !== t.boss.cardId && all.findIndex((x) => Number(x.id) === Number(r.id)) === i,
  );
  await withTimeout(
    ctx.wiki.load(
      others.slice(0, 8).map((c) => ({ cardId: Number(c.id), title: c.title })),
      undefined,
      { fresh: true },
    ),
    QUESTION_PREP_MS - 1_500,
    [],
  );
  const [summaries, attrs] = await Promise.all([
    ctx.wiki.summaries([...ids, ...candidates.map((c) => Number(c.id))]),
    ctx.wiki.attributes(ids),
  ]);
  const quiz = (id: number, t2: string, views: string | number): QuizArticle => {
    const s = summaries.get(id);
    return {
      cardId: id,
      title: t2,
      views12m: Number(views),
      extract: s?.extract ?? null,
      description: s?.description ?? null,
      thumbUrl: s?.thumbUrl ?? null,
    };
  };
  const full = (id: number, t2: string, views: string | number, rarity: Rarity): BossQuizArticle => {
    const a = attrs.get(id);
    return { ...quiz(id, t2, views), rarity, year: a?.year ?? null, yearKind: a?.yearKind ?? null };
  };
  return makeBossQuestion(
    t.seed,
    full(t.cardId, title, target?.views_12m ?? 0, t.rarity),
    candidates.map((c) => quiz(Number(c.id), c.title, c.views_12m)),
    {
      boss: bossRow ? full(t.boss.cardId, bossRow.title, bossRow.views_12m, bossRow.rarity) : null,
      history: history.map((h) => ({ type: h.type, key: h.key, askedAt: new Date(h.asked_at).getTime() })),
      avoid: t.avoid,
      maxYear: parisYear(ctx.now()),
    },
  );
}
