import { schema } from "@palacards/db";
import { effectiveStats, RARITIES, type Rarity } from "@palacards/game";
import type { CardDTO, Page } from "@palacards/shared";
import { and, desc, eq, inArray, sql, type SQL } from "@palacards/db";
import type { Ctx } from "../context.js";
import { badRequest, notFound } from "../errors.js";
import { activeSeason, type DbOrTx } from "./players.js";
import { articleUrl } from "./wiki.js";

const ci = schema.cardInstances;
const c = schema.cards;
const w = schema.wikiSummaries;

/** Colonnes communes pour afficher un exemplaire. */
export const instanceColumns = {
  instanceId: ci.id,
  cardId: ci.cardId,
  season: ci.season,
  title: c.title,
  rarity: ci.rarity,
  baseAtk: ci.atk,
  baseDef: ci.def,
  level: ci.level,
  views12m: c.views12m,
  favorite: ci.favorite,
  locked: ci.lockedBy,
  pinnedSlot: ci.pinnedSlot,
  thumbUrl: w.thumbUrl,
  pageUrl: w.pageUrl,
  obtainedAt: ci.obtainedAt,
  ownerId: ci.ownerId,
};

type InstanceRow = {
  instanceId: number;
  cardId: number;
  season: number;
  title: string;
  rarity: Rarity;
  baseAtk: number;
  baseDef: number;
  level: number;
  views12m: number;
  favorite: boolean;
  locked: "auction" | "trade" | null;
  pinnedSlot: number | null;
  thumbUrl: string | null;
  pageUrl: string | null;
  obtainedAt: Date;
};

export function toCardDTO(r: InstanceRow, extra: Partial<CardDTO> = {}): CardDTO {
  const { atk, def } = effectiveStats(r.baseAtk, r.baseDef, r.level);
  return {
    instanceId: r.instanceId,
    cardId: r.cardId,
    season: r.season,
    title: r.title,
    rarity: r.rarity,
    atk,
    def,
    level: r.level,
    views12m: r.views12m,
    favorite: r.favorite,
    locked: r.locked,
    pinnedSlot: r.pinnedSlot,
    thumbUrl: r.thumbUrl,
    pageUrl: r.pageUrl ?? articleUrl(r.title),
    obtainedAt: r.obtainedAt.toISOString(),
    ...extra,
  };
}

/** Requête de base : exemplaires avec leur article et leur image. */
export function selectInstances(db: DbOrTx) {
  return db
    .select(instanceColumns)
    .from(ci)
    .innerJoin(c, and(eq(c.season, ci.season), eq(c.id, ci.cardId)))
    .leftJoin(w, eq(w.pageId, ci.cardId));
}

export async function instancesByIds(db: DbOrTx, ids: number[]): Promise<CardDTO[]> {
  if (ids.length === 0) return [];
  const rows = await selectInstances(db).where(inArray(ci.id, ids));
  const byId = new Map(rows.map((r) => [r.instanceId, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [toCardDTO(r)] : [];
  });
}

/** Tags de plusieurs exemplaires. */
export async function tagsOf(db: DbOrTx, instanceIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!instanceIds.length) return out;
  const rows = await db.select().from(schema.userTags).where(inArray(schema.userTags.instanceId, instanceIds));
  for (const r of rows) out.set(r.instanceId, [...(out.get(r.instanceId) ?? []), r.tag]);
  return out;
}

/** Charge en arrière-plan les images manquantes et les pousse au joueur au fil de l'eau. */
export function loadMediaInBackground(ctx: Ctx, userId: string, cards: { cardId: number; title: string }[]) {
  void ctx.wiki
    .load(cards, (media) => ctx.rt.toUser(userId, "card:media", media))
    .catch((err) => ctx.log.warn({ err }, "chargement des images"));
}

// ---------------------------------------------------------------------------
// Catalogue « Toutes les cartes »
// ---------------------------------------------------------------------------

export type CatalogSort = "views" | "atk" | "def" | "title";

interface CatalogQuery {
  q?: string;
  rarity?: Rarity[];
  minAtk?: number;
  maxAtk?: number;
  minDef?: number;
  maxDef?: number;
  owned?: "yes" | "no";
  sort: CatalogSort;
  cursor?: string;
  limit: number;
}

// `fuzzy` : pagination d'une recherche approchante (aucun titre ne contenait tous les mots).
type Cursor = { v: number | string; id: number; fuzzy?: boolean };

const encodeCursor = (cur: Cursor) => Buffer.from(JSON.stringify(cur)).toString("base64url");
function decodeCursor(raw: string): Cursor {
  try {
    const cur = JSON.parse(Buffer.from(raw, "base64url").toString()) as Cursor;
    if (typeof cur.id !== "number" || (typeof cur.v !== "number" && typeof cur.v !== "string")) throw new Error();
    if (cur.fuzzy !== undefined && typeof cur.fuzzy !== "boolean") throw new Error();
    return cur;
  } catch {
    throw badRequest("invalid_cursor", "Curseur de pagination invalide.");
  }
}

/** Mots d'une recherche, échappés pour LIKE (au plus 8). */
function searchWords(q: string): string[] {
  const words = q
    .split(/[\s'’,.;:!?()«»"]+/)
    .filter(Boolean)
    .slice(0, 8);
  // Un mot de moins de 3 lettres n'a pas de trigramme : il filtre, mais ne peut pas guider l'index seul.
  const usable = words.some((w) => w.length >= 3) ? words : [q];
  return usable.map((w) => w.replace(/[\\%_]/g, "\\$&"));
}

/**
 * Catalogue de la saison active, paginé par curseur (keyset) : pas d'OFFSET sur 2,7 M lignes.
 * Recherche sans accents sur `search_title` (colonne normalisée, index trigram) en deux temps :
 * 1. titres contenant tous les mots, dans le tri choisi (vues par défaut : l'article principal d'abord) ;
 * 2. sinon (faute de frappe), titres approchants par similarité de mots (`<%`), dans le même tri.
 * Trier par similarité tous les titres d'un mot fréquent (« château ») coûtait des centaines de ms.
 */
export async function catalog(ctx: Ctx, userId: string, query: CatalogQuery): Promise<Page<CardDTO> & { approximate: boolean }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const q = query.q?.trim() || undefined;
  const exact = await catalogPage(ctx, userId, query, q, cursor, cursor?.fuzzy ?? false);
  if (q && !cursor && exact.items.length === 0) return { ...(await catalogPage(ctx, userId, query, q, null, true)), approximate: true };
  return { ...exact, approximate: cursor?.fuzzy ?? false };
}

async function catalogPage(
  ctx: Ctx,
  userId: string,
  query: CatalogQuery,
  q: string | undefined,
  cursor: Cursor | null,
  fuzzy: boolean,
): Promise<Page<CardDTO>> {
  const season = await activeSeason(ctx.db);
  const where: SQL[] = [sql`c.season = ${season}`];
  if (query.rarity?.length)
    where.push(
      sql`c.rarity in (${sql.join(
        query.rarity.map((r) => sql`${r}::rarity`),
        sql`, `,
      )})`,
    );
  if (query.minAtk !== undefined) where.push(sql`c.atk >= ${query.minAtk}`);
  if (query.maxAtk !== undefined) where.push(sql`c.atk <= ${query.maxAtk}`);
  if (query.minDef !== undefined) where.push(sql`c.def >= ${query.minDef}`);
  if (query.maxDef !== undefined) where.push(sql`c.def <= ${query.maxDef}`);
  const ownedExpr = sql`exists (select 1 from card_instances o where o.owner_id = ${userId} and o.card_id = c.id)`;
  // « Possédées » : on part des exemplaires du joueur (petit ensemble) plutôt que de toute la saison.
  if (query.owned === "yes") where.push(sql`c.id in (select o.card_id from card_instances o where o.owner_id = ${userId})`);
  if (query.owned === "no") where.push(sql`not ${ownedExpr}`);

  if (q && fuzzy) where.push(sql`lower(f_unaccent(${q})) <% c.search_title`);
  else if (q) for (const w of searchWords(q)) where.push(sql`c.search_title like '%' || lower(f_unaccent(${w})) || '%'`);
  // Même tri pour les deux modes : trier des dizaines de milliers de candidats par similarité coûtait trop cher.
  let sortExpr: SQL;
  let desc_ = true;
  if (query.sort === "title") {
    sortExpr = sql`c.title`;
    desc_ = false;
  } else {
    sortExpr = query.sort === "atk" ? sql`c.atk` : query.sort === "def" ? sql`c.def` : sql`c.views_12m`;
  }
  if (cursor) {
    // Le type de la valeur doit suivre le tri (texte pour le titre, nombre sinon), sinon erreur SQL.
    if ((typeof cursor.v === "string") !== (query.sort === "title")) throw badRequest("invalid_cursor", "Curseur de pagination invalide.");
    where.push(
      desc_ ? sql`(${sortExpr}, c.id) < (${cursor.v}, ${cursor.id})` : sql`(${sortExpr}, c.id) > (${cursor.v}, ${cursor.id})`,
    );
  }
  const dir = desc_ ? sql`desc` : sql`asc`;
  const rows = await ctx.db.execute<{
    id: string;
    season: number;
    title: string;
    rarity: Rarity;
    atk: number;
    def: number;
    views_12m: string;
    sort_value: string | number;
    thumb_url: string | null;
    page_url: string | null;
    owned: boolean;
  }>(sql`
    select c.id, c.season, c.title, c.rarity, c.atk, c.def, c.views_12m, ${sortExpr} as sort_value,
           w.thumb_url, w.page_url, ${ownedExpr} as owned
    from cards c left join wiki_summaries w on w.page_id = c.id
    where ${sql.join(where, sql` and `)}
    order by ${sortExpr} ${dir}, c.id ${dir}
    limit ${query.limit + 1}
  `);
  const items = rows.slice(0, query.limit).map((r): CardDTO => ({
    instanceId: null,
    cardId: Number(r.id),
    season: r.season,
    title: r.title,
    rarity: r.rarity,
    atk: r.atk,
    def: r.def,
    level: 1,
    views12m: Number(r.views_12m),
    thumbUrl: r.thumb_url,
    pageUrl: r.page_url ?? articleUrl(r.title),
    owned: r.owned,
  }));
  const last = rows[query.limit - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor({
          v: query.sort === "title" ? String(last.sort_value) : Number(last.sort_value),
          id: Number(last.id),
          ...(fuzzy ? { fuzzy: true } : {}),
        })
      : null;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// Fiche carte
// ---------------------------------------------------------------------------

export async function cardSheet(ctx: Ctx, userId: string, cardId: number) {
  const season = await activeSeason(ctx.db);
  // Saison active en priorité, sinon la plus récente où l'article existe.
  const [card] = await ctx.db
    .select()
    .from(c)
    .where(eq(c.id, cardId))
    .orderBy(sql`${c.season} = ${season} desc`, desc(c.season))
    .limit(1);
  if (!card) throw notFound("Cette carte n'existe pas.");

  let media = (await ctx.wiki.cached([cardId])).get(cardId);
  if (!media) {
    const [loaded] = await ctx.wiki.load([{ cardId, title: card.title }]);
    media = loaded;
  }

  const owners = await ctx.db.execute<{ user_id: string; username: string; copies: number; best_level: number }>(sql`
    select u.id as user_id, coalesce(u.display_username, u.name) as username, count(*)::int as copies, max(ci.level)::int as best_level
    from card_instances ci join "user" u on u.id = ci.owner_id
    where ci.card_id = ${cardId}
    group by u.id, u.display_username, u.name
    order by copies desc, username
  `);
  const mine = await selectInstances(ctx.db)
    .where(and(eq(ci.cardId, cardId), eq(ci.ownerId, userId)))
    .orderBy(desc(ci.level), desc(ci.atk));
  const tags = await tagsOf(
    ctx.db,
    mine.map((r) => r.instanceId),
  );
  const [wish] = await ctx.db
    .select({ n: sql<number>`1` })
    .from(schema.wishlist)
    .where(and(eq(schema.wishlist.userId, userId), eq(schema.wishlist.cardId, cardId)));

  return {
    card: {
      instanceId: null,
      cardId,
      season: card.season,
      title: card.title,
      rarity: card.rarity,
      atk: card.atk,
      def: card.def,
      level: 1,
      views12m: card.views12m,
      thumbUrl: media?.thumbUrl ?? null,
      pageUrl: media?.pageUrl ?? articleUrl(card.title),
      owned: mine.length > 0,
    } satisfies CardDTO,
    pageLen: card.pageLen,
    extract: media?.extract ?? null,
    inActiveSeason: card.season === season,
    owners: owners.map((o) => ({ userId: o.user_id, username: o.username, copies: o.copies, bestLevel: o.best_level })),
    mine: mine.map((r) => toCardDTO(r, { tags: tags.get(r.instanceId) ?? [] })),
    wishlisted: Boolean(wish),
  };
}

/** Nombre de cartes par rareté dans la saison active (dénominateur de la complétion). */
// Les cartes d'une saison active ne changent plus : un comptage (≈ 100 ms sur 2,7 M lignes) par saison et par processus.
const totalsCache = new Map<number, Record<Rarity, number>>();

/** Nombre de cartes par rareté dans la saison (mis en cache une fois la saison peuplée). */
export async function seasonTotals(db: DbOrTx, season: number): Promise<Record<Rarity, number>> {
  const cached = totalsCache.get(season);
  if (cached) return cached;
  const out = await countSeason(db, season);
  if (Object.values(out).some((n) => n > 0)) totalsCache.set(season, out);
  return out;
}

async function countSeason(db: DbOrTx, season: number): Promise<Record<Rarity, number>> {
  const rows = await db
    .select({ rarity: c.rarity, n: sql<number>`count(*)::int` })
    .from(c)
    .where(eq(c.season, season))
    .groupBy(c.rarity);
  const out = Object.fromEntries(RARITIES.map((r) => [r, 0])) as Record<Rarity, number>;
  for (const r of rows) out[r.rarity] = r.n;
  return out;
}
