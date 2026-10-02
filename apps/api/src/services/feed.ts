import { and, eq, inArray, schema, sql } from "@palacards/db";
import {
  FEED_REACTIONS,
  rarityRank,
  WEIRD_GENRE_KEYS,
  WEIRD_GENRES,
  weirdGenresOfTitle,
  type Rarity,
} from "@palacards/game";
import type { FeedDTO, FeedItemDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, notFound } from "../errors.js";
import type { DbOrTx } from "./players.js";
import { articleUrl } from "./wiki.js";

export const WEIRD_REFRESH_JOB = "weird-refresh";
/** Profondeur de sous-catégories parcourue pour chaque catégorie « bizarre ». */
const WEIRD_DEPTH = 1;
/** Fenêtres des fils : tirages récents seulement. */
const BEST_DAYS = 7;
const WEIRD_DAYS = 14;
const SHINY_DAYS = 60;
export const FEED_PAGE = 24;

export type PullSource = "pack" | "theme" | "wheel" | "upgrade" | "boss";

export interface PullInput {
  cardId: number;
  season: number;
  rarity: Rarity;
  shiny: boolean;
  title: string;
}

/**
 * Journalise des tirages (fil d'activité) dans la transaction du tirage. Les genres « bizarres » repérés
 * par mots-clés dans le titre sont figés ici ; ceux des catégories Wikipédia sont lus à l'affichage.
 * Renvoie les tirages marquants (UR et plus, brillantes, bizarres) à annoncer après le commit.
 */
export async function logPulls(db: DbOrTx, userId: string, source: PullSource, items: PullInput[]) {
  if (!items.length) return [];
  const weird = new Set(
    (
      await db
        .selectDistinct({ cardId: schema.weirdCards.cardId })
        .from(schema.weirdCards)
        .where(
          inArray(
            schema.weirdCards.cardId,
            items.map((i) => i.cardId),
          ),
        )
    ).map((r) => r.cardId),
  );
  const rows = await db
    .insert(schema.pulls)
    .values(
      items.map((i) => ({
        userId,
        cardId: i.cardId,
        season: i.season,
        rarity: i.rarity,
        shiny: i.shiny,
        source,
        genres: weirdGenresOfTitle(i.title),
      })),
    )
    .returning({
      id: schema.pulls.id,
      rarity: schema.pulls.rarity,
      shiny: schema.pulls.shiny,
      cardId: schema.pulls.cardId,
      genres: schema.pulls.genres,
    });
  return rows
    .filter((r) => rarityRank(r.rarity) >= rarityRank("UR") || r.shiny || r.genres.length > 0 || weird.has(r.cardId))
    .map((r) => r.id);
}

type FeedRow = {
  id: string;
  user_id: string;
  card_id: string;
  season: number;
  rarity: Rarity;
  shiny: boolean;
  source: string;
  created_at: Date | string;
  genres: string[] | null;
  title: string;
  atk: number;
  def: number;
  thumb_url: string | null;
  page_url: string | null;
  username: string;
  name: string;
  avatar: string | null;
};

/** Genres d'un tirage : mots-clés figés au tirage + catégories Wikipédia (rechargées en tâche de fond). */
const genresSql = sql`array(select distinct g from unnest(p.genres || coalesce((select array_agg(w.genre) from weird_cards w where w.card_id = p.card_id), '{}'::text[])) g)`;

function feedSelect(where: ReturnType<typeof sql>, order: ReturnType<typeof sql>, limit: number, offset: number) {
  return sql`
    select p.id, p.user_id, p.card_id, p.season, p.rarity, p.shiny, p.source, p.created_at,
           ${genresSql} as genres,
           c.title, c.atk, c.def, s.thumb_url, s.page_url,
           u.username, coalesce(u.display_username, u.name) as name, pl.avatar
    from pulls p
    join cards c on c.season = p.season and c.id = p.card_id
    join "user" u on u.id = p.user_id
    join players pl on pl.user_id = p.user_id
    left join wiki_summaries s on s.page_id = p.card_id
    where ${where}
    order by ${order}
    limit ${limit} offset ${offset}
  `;
}

async function reactionsOf(db: DbOrTx, ids: number[], viewerId: string) {
  const out = new Map<number, FeedItemDTO["reactions"]>();
  if (!ids.length) return out;
  const rows = await db.execute<{ pull_id: string; emoji: string; n: number; mine: boolean }>(sql`
    select pull_id, emoji, count(*)::int as n, bool_or(user_id = ${viewerId}) as mine
    from pull_reactions where pull_id in (${sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    )})
    group by pull_id, emoji
  `);
  for (const r of rows) {
    const id = Number(r.pull_id);
    out.set(id, [...(out.get(id) ?? []), { emoji: r.emoji, count: r.n, mine: r.mine }]);
  }
  for (const [id, list] of out)
    out.set(
      id,
      list.sort(
        (a, b) =>
          FEED_REACTIONS.indexOf(a.emoji as (typeof FEED_REACTIONS)[number]) -
          FEED_REACTIONS.indexOf(b.emoji as (typeof FEED_REACTIONS)[number]),
      ),
    );
  return out;
}

function toItem(r: FeedRow, reactions: FeedItemDTO["reactions"]): FeedItemDTO {
  return {
    id: Number(r.id),
    card: {
      instanceId: null,
      cardId: Number(r.card_id),
      season: r.season,
      title: r.title,
      rarity: r.rarity,
      atk: r.atk,
      def: r.def,
      level: 1,
      shiny: r.shiny,
      thumbUrl: r.thumb_url,
      pageUrl: r.page_url ?? articleUrl(r.title),
    },
    user: { id: r.user_id, name: r.name, username: r.username, avatar: r.avatar },
    source: r.source,
    createdAt: new Date(r.created_at).toISOString(),
    genres: (r.genres ?? []).filter((g) => WEIRD_GENRE_KEYS.includes(g)),
    reactions,
  };
}

export type FeedKind = "best" | "weird" | "shiny";

/**
 * Fils d'activité :
 * - `best` : meilleurs tirages des 7 derniers jours (rareté, puis brillante, puis le plus récent) ;
 * - `weird` : tirages « bizarres » des 14 derniers jours (catégories Wikipédia ou mots-clés), filtrables par genre ;
 * - `shiny` : brillantes des 60 derniers jours.
 */
export async function listFeed(
  ctx: Ctx,
  viewerId: string,
  kind: FeedKind,
  options: { genre?: string; cursor?: string; limit?: number } = {},
): Promise<FeedDTO> {
  const limit = Math.min(options.limit ?? FEED_PAGE, 60);
  const offset = Math.max(0, Number(options.cursor ?? 0) || 0);
  if (options.genre && !WEIRD_GENRE_KEYS.includes(options.genre)) throw badRequest("genre", "Genre inconnu.");
  const since = (days: number) => sql`p.created_at > now() - make_interval(days => ${days})`;
  let where;
  let order;
  if (kind === "best") {
    where = sql`${since(BEST_DAYS)} and (p.rarity in ('SR', 'UR', 'L') or p.shiny)`;
    order = sql`array_position(array['C','PC','R','SR','UR','L']::rarity[], p.rarity) desc, p.shiny desc, p.id desc`;
  } else if (kind === "shiny") {
    where = sql`${since(SHINY_DAYS)} and p.shiny`;
    order = sql`p.id desc`;
  } else {
    const genre = options.genre;
    where = genre
      ? sql`${since(WEIRD_DAYS)} and (${genre} = any(p.genres) or exists (select 1 from weird_cards w where w.card_id = p.card_id and w.genre = ${genre}))`
      : sql`${since(WEIRD_DAYS)} and (cardinality(p.genres) > 0 or exists (select 1 from weird_cards w where w.card_id = p.card_id))`;
    order = sql`p.id desc`;
  }
  const rows = await ctx.db.execute<FeedRow>(feedSelect(where, order, limit + 1, offset));
  const page = rows.slice(0, limit);
  const reactions = await reactionsOf(
    ctx.db,
    page.map((r) => Number(r.id)),
    viewerId,
  );
  return {
    items: page.map((r) => toItem(r, reactions.get(Number(r.id)) ?? [])),
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  };
}

/** Tirages marquants, au format du fil (annonce en direct). */
export async function feedItems(db: DbOrTx, ids: number[]): Promise<FeedItemDTO[]> {
  if (!ids.length) return [];
  const rows = await db.execute<FeedRow>(
    feedSelect(
      sql`p.id in (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`,
      sql`p.id`,
      ids.length,
      0,
    ),
  );
  return rows.map((r) => toItem(r, []));
}

/** Annonce les tirages marquants à tous les joueurs connectés (après le commit du tirage). */
export async function announcePulls(ctx: Ctx, userId: string, ids: number[]) {
  if (!ids.length) return;
  for (const item of await feedItems(ctx.db, ids)) ctx.rt.toAll("feed:new", item);
}

/** Ajoute ou retire une réaction ; renvoie les réactions à jour du tirage. */
export async function toggleReaction(ctx: Ctx, userId: string, pullId: number, emoji: string) {
  if (!FEED_REACTIONS.includes(emoji as (typeof FEED_REACTIONS)[number]))
    throw badRequest("emoji", "Réaction inconnue.");
  const [pull] = await ctx.db.select({ id: schema.pulls.id }).from(schema.pulls).where(eq(schema.pulls.id, pullId));
  if (!pull) throw notFound("Ce tirage n'est plus dans le fil.");
  const removed = await ctx.db
    .delete(schema.pullReactions)
    .where(
      and(
        eq(schema.pullReactions.pullId, pullId),
        eq(schema.pullReactions.userId, userId),
        eq(schema.pullReactions.emoji, emoji),
      ),
    )
    .returning({ id: schema.pullReactions.pullId });
  if (!removed.length)
    await ctx.db.insert(schema.pullReactions).values({ pullId, userId, emoji }).onConflictDoNothing();
  return { reactions: (await reactionsOf(ctx.db, [pullId], userId)).get(pullId) ?? [] };
}

/**
 * Recharge les articles des catégories « bizarres » (API MediaWiki, un niveau de sous-catégories). Une
 * catégorie qui n'existe pas ou une erreur réseau n'efface pas les articles déjà connus de son genre.
 */
export async function refreshWeirdCards(ctx: Ctx) {
  const summary: Record<string, number> = {};
  for (const genre of WEIRD_GENRES) {
    const ids = new Set<number>();
    for (const category of genre.categories) {
      try {
        for (const id of await ctx.wiki.categoryMembers(category, WEIRD_DEPTH)) ids.add(id);
      } catch (err) {
        ctx.log.warn({ err, category }, "catégorie bizarre illisible");
      }
      // Politesse envers l'API Wikimédia : une catégorie à la fois, avec une pause.
      await new Promise((r) => setTimeout(r, 500));
    }
    summary[genre.key] = ids.size;
    if (!ids.size) continue;
    await ctx.db.transaction(async (tx) => {
      await tx.delete(schema.weirdCards).where(eq(schema.weirdCards.genre, genre.key));
      const list = [...ids];
      for (let i = 0; i < list.length; i += 5_000)
        await tx
          .insert(schema.weirdCards)
          .values(list.slice(i, i + 5_000).map((cardId) => ({ cardId, genre: genre.key })))
          .onConflictDoNothing();
    });
  }
  ctx.log.info(summary, "catégories bizarres rechargées");
  return summary;
}

let refreshing = false;
/** Lance le rechargement des catégories en arrière-plan (un seul à la fois) ; false s'il tourne déjà. */
export function startWeirdRefresh(ctx: Ctx): boolean {
  if (refreshing) return false;
  refreshing = true;
  void refreshWeirdCards(ctx)
    .catch((err) => ctx.log.error({ err }, "catégories bizarres"))
    .finally(() => (refreshing = false));
  return true;
}

/** Purge du journal des tirages (fil d'activité) au-delà de 60 jours. */
export async function purgeOldPulls(ctx: Ctx) {
  const rows = await ctx.db.execute(sql`delete from pulls where created_at < now() - interval '60 days'`);
  return rows.count;
}
