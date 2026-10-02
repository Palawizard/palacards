import { sql } from "@palacards/db";
import {
  descriptionHead,
  makeQuestion,
  seededRandom,
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
