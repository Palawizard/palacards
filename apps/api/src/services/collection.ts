import { and, desc, eq, inArray, schema, sql, type SQL } from "@palacards/db";
import {
  effectiveStats,
  isBetterCopy,
  LEVEL_BONUS,
  MAX_LEVEL,
  planFusions,
  RARITIES,
  recycleValue,
  type FusionCopy,
  type Rarity,
} from "@palacards/game";
import type { CardDTO, Page } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { seasonTotals, selectInstances, toCardDTO } from "./cards.js";
import { activeSeason, lockPlayer, logMovement, movePw, ownedCount, pushWallet, type DbOrTx } from "./players.js";
import { emit } from "./progression.js";

const ci = schema.cardInstances;
const c = schema.cards;

/** Exemplaires demandés dans un échange en attente : ni recyclables ni fusionnables (le destinataire peut refuser l'échange). */
export async function requestedInPendingTrades(tx: DbOrTx, ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await tx
    .select({ id: schema.tradeItems.instanceId })
    .from(schema.tradeItems)
    .innerJoin(schema.trades, eq(schema.trades.id, schema.tradeItems.tradeId))
    .where(and(inArray(schema.tradeItems.instanceId, ids), eq(schema.trades.status, "pending")));
  return new Set(rows.map((r) => r.id));
}

export type CollectionSort = "date" | "atk" | "def" | "views" | "rarity" | "title";

export interface CollectionQuery {
  rarity?: Rarity[];
  season?: number;
  tag?: string;
  /** Booster à thème : seulement les articles qui en font partie. */
  theme?: number;
  /** Seulement les favorites, ou toutes sauf elles. */
  favorites?: "only" | "exclude";
  /** Seulement les brillantes. */
  shiny?: boolean;
  duplicates?: boolean;
  q?: string;
  /** La recherche porte aussi sur le résumé Wikipédia (et la description courte) de l'article. */
  inSummary?: boolean;
  sort: CollectionSort;
  page: number;
  limit: number;
}

/** Filtres de la collection (sans tri ni pagination). */
export type CollectionFilters = Omit<CollectionQuery, "sort" | "page" | "limit">;

/** Échappe `%`, `_` et `\\` : la saisie est cherchée telle quelle dans un LIKE. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Conditions SQL des filtres de collection (la requête joint `cards` pour la recherche par titre). */
function collectionWhere(ownerId: string, query: CollectionFilters): SQL[] {
  const where: SQL[] = [eq(ci.ownerId, ownerId)];
  if (query.rarity?.length) where.push(inArray(ci.rarity, query.rarity));
  if (query.season) where.push(eq(ci.season, query.season));
  if (query.favorites) where.push(eq(ci.favorite, query.favorites === "only"));
  if (query.shiny) where.push(eq(ci.shiny, true));
  if (query.tag)
    where.push(sql`exists (select 1 from user_tags t where t.instance_id = ${ci.id} and t.tag = ${query.tag})`);
  if (query.theme)
    where.push(
      sql`exists (select 1 from theme_cards tc where tc.theme_id = ${query.theme} and tc.card_id = ${ci.cardId})`,
    );
  if (query.duplicates) {
    where.push(
      sql`(select count(*) from card_instances d where d.owner_id = ${ownerId} and d.card_id = ${ci.cardId}) > 1`,
    );
  }
  const q = query.q?.trim();
  if (q) {
    const pattern = sql`'%' || lower(f_unaccent(${escapeLike(q)})) || '%'`;
    where.push(
      query.inSummary
        ? sql`(${c.searchTitle} like ${pattern} or exists (
            select 1 from wiki_summaries s where s.page_id = ${ci.cardId}
            and lower(f_unaccent(coalesce(s.description, '') || ' ' || coalesce(s.extract, ''))) like ${pattern}
          ))`
        : sql`${c.searchTitle} like ${pattern}`,
    );
  }
  return where;
}

/**
 * Collection d'un joueur, filtrée et triée (pagination par page : quelques milliers de cartes au plus).
 * Vue par un autre joueur (`viewerId` ≠ `ownerId`) : ni vues ni tri par vues (« Plus lu » en duel).
 */
export async function listCollection(
  ctx: Ctx,
  ownerId: string,
  query: CollectionQuery,
  viewerId: string,
): Promise<Page<CardDTO>> {
  const byViews = viewerId === ownerId ? sql`${c.views12m} desc` : sql`${c.title} asc`;
  const where = collectionWhere(ownerId, query);

  const order: SQL[] = {
    date: [sql`${ci.obtainedAt} desc`],
    atk: [sql`${ci.atk} * (1 + ${LEVEL_BONUS}::numeric * (${ci.level} - 1)) desc`],
    def: [sql`${ci.def} * (1 + ${LEVEL_BONUS}::numeric * (${ci.level} - 1)) desc`],
    views: [byViews],
    rarity: [sql`${ci.rarity} desc`, byViews],
    title: [sql`${c.title} asc`],
  }[query.sort];

  const rows = await selectInstances(ctx.db)
    .where(and(...where))
    .orderBy(...order, desc(ci.id))
    .limit(query.limit + 1)
    .offset(query.page * query.limit);
  const [countRow] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(ci)
    .innerJoin(c, and(eq(c.season, ci.season), eq(c.id, ci.cardId)))
    .where(and(...where));

  const page = rows.slice(0, query.limit);
  const ids = page.map((r) => r.instanceId);
  const tags = ids.length
    ? await ctx.db.select().from(schema.userTags).where(inArray(schema.userTags.instanceId, ids))
    : [];
  const copies = page.length
    ? await ctx.db
        .select({ cardId: ci.cardId, n: sql<number>`count(*)::int` })
        .from(ci)
        .where(and(eq(ci.ownerId, ownerId), inArray(ci.cardId, [...new Set(page.map((r) => r.cardId))])))
        .groupBy(ci.cardId)
    : [];
  const copiesBy = new Map(copies.map((r) => [r.cardId, r.n]));
  return {
    items: page.map((r) =>
      toCardDTO(
        r,
        {
          tags: tags.filter((t) => t.instanceId === r.instanceId).map((t) => t.tag),
          copies: copiesBy.get(r.cardId) ?? 1,
        },
        viewerId,
      ),
    ),
    nextCursor: rows.length > query.limit ? String(query.page + 1) : null,
    total: countRow?.n ?? 0,
  };
}

export const SUMMARY_BACKFILL_JOB = "summary-backfill";

/** Résumés chargés au plus par appel (5 requêtes Wikipédia simultanées au plus, voir `createWiki`). */
export const SUMMARY_BACKFILL_BATCH = 300;
const SUMMARY_BACKFILL_EVERY_MS = 10 * 60_000;
const lastBackfill = new Map<string, number>();

/**
 * Articles possédés (par `ownerId`, ou par n'importe qui) dont le résumé Wikipédia n'est pas encore en cache :
 * la recherche dans le résumé ne les trouverait pas.
 */
async function ownedWithoutSummary(ctx: Ctx, ownerId: string | null, limit: number) {
  const rows = await ctx.db.execute<{ id: string; title: string }>(sql`
    select c.id, min(c.title) as title
    from card_instances i
    join cards c on c.season = i.season and c.id = i.card_id
    where ${ownerId ? sql`i.owner_id = ${ownerId}` : sql`true`}
      and not exists (select 1 from wiki_summaries s where s.page_id = i.card_id)
    group by c.id
    limit ${limit}
  `);
  return rows.map((r) => ({ cardId: Number(r.id), title: r.title }));
}

/**
 * Charge en arrière-plan les résumés manquants des cartes d'un joueur (recherche « dans le résumé »),
 * au plus une fois toutes les 10 minutes par joueur. Ne fait jamais attendre la requête.
 */
export function loadOwnedSummaries(ctx: Ctx, ownerId: string) {
  const now = Date.now();
  if (now - (lastBackfill.get(ownerId) ?? 0) < SUMMARY_BACKFILL_EVERY_MS) return;
  lastBackfill.set(ownerId, now);
  void ownedWithoutSummary(ctx, ownerId, SUMMARY_BACKFILL_BATCH)
    .then((cards) => ctx.wiki.load(cards))
    .catch((err) => ctx.log.warn({ err }, "résumés de la collection"));
}

/** Job : résumés manquants des cartes possédées par tous les joueurs, par lots. Renvoie le nombre chargé. */
export async function backfillOwnedSummaries(ctx: Ctx, limit = SUMMARY_BACKFILL_BATCH): Promise<number> {
  return (await ctx.wiki.load(await ownedWithoutSummary(ctx, null, limit))).length;
}

/** Exemplaires du joueur par id (ceux des autres sont ignorés), dans l'ordre demandé. */
export async function ownInstances(ctx: Ctx, ownerId: string, ids: number[]): Promise<CardDTO[]> {
  if (!ids.length) return [];
  const rows = await selectInstances(ctx.db).where(and(inArray(ci.id, ids), eq(ci.ownerId, ownerId)));
  const byId = new Map(rows.map((r) => [r.instanceId, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [toCardDTO(r, {}, ownerId)] : [];
  });
}

/** Complétion par rareté : articles différents possédés / articles de la saison active. */
export async function completion(ctx: Ctx, ownerId: string) {
  const season = await activeSeason(ctx.db);
  const totals = await seasonTotals(ctx.db, season);
  const owned = await ctx.db
    .select({ rarity: ci.rarity, n: sql<number>`count(distinct ${ci.cardId})::int` })
    .from(ci)
    .where(and(eq(ci.ownerId, ownerId), eq(ci.season, season)))
    .groupBy(ci.rarity);
  const ownedBy = new Map(owned.map((r) => [r.rarity, r.n]));
  const [all] = await ctx.db
    .select({ cards: sql<number>`count(*)::int`, unique: sql<number>`count(distinct ${ci.cardId})::int` })
    .from(ci)
    .where(eq(ci.ownerId, ownerId));
  const tags = await ctx.db
    .selectDistinct({ tag: schema.userTags.tag })
    .from(schema.userTags)
    .innerJoin(ci, eq(ci.id, schema.userTags.instanceId))
    .where(eq(ci.ownerId, ownerId))
    .orderBy(schema.userTags.tag);
  const themes = await themesOwned(ctx.db, ownerId);
  const seasonsOwned = await ctx.db
    .selectDistinct({ season: ci.season })
    .from(ci)
    .where(eq(ci.ownerId, ownerId))
    .orderBy(ci.season);
  return {
    season,
    byRarity: [...RARITIES].reverse().map((r) => ({ rarity: r, owned: ownedBy.get(r) ?? 0, total: totals[r] })),
    totalCards: all?.cards ?? 0,
    uniqueCards: all?.unique ?? 0,
    tags: tags.map((t) => t.tag),
    seasons: seasonsOwned.map((s) => s.season),
    themes,
  };
}

/** Boosters à thème dont le joueur possède au moins un article (les plus récents d'abord). */
async function themesOwned(db: DbOrTx, ownerId: string) {
  const rows = await db.execute<{ id: string; name: string; owned: number; card_count: number }>(sql`
    select t.id, t.name, t.card_count, count(distinct tc.card_id)::int as owned
    from themes t
    join theme_cards tc on tc.theme_id = t.id
    where exists (select 1 from card_instances i where i.owner_id = ${ownerId} and i.card_id = tc.card_id)
    group by t.id
    order by t.starts_at desc, t.id desc
  `);
  return rows.map((r) => ({ id: Number(r.id), name: r.name, owned: r.owned, cardCount: r.card_count }));
}

/** Tags déjà utilisés par le joueur, les plus fréquents d'abord (suggestions de la fiche carte). */
export async function tagCounts(ctx: Ctx, ownerId: string) {
  const rows = await ctx.db
    .select({ tag: schema.userTags.tag, count: sql<number>`count(*)::int` })
    .from(schema.userTags)
    .innerJoin(ci, eq(ci.id, schema.userTags.instanceId))
    .where(eq(ci.ownerId, ownerId))
    .groupBy(schema.userTags.tag)
    .orderBy(sql`count(*) desc`, schema.userTags.tag);
  return { tags: rows };
}

export async function setFavorite(ctx: Ctx, ownerId: string, instanceId: number, favorite: boolean) {
  // Condition sur le propriétaire dans la même requête : pas de fenêtre entre vérification et écriture.
  const rows = await ctx.db
    .update(ci)
    .set({ favorite })
    .where(and(eq(ci.id, instanceId), eq(ci.ownerId, ownerId)))
    .returning({ id: ci.id });
  if (!rows.length) throw notFound("Carte introuvable dans ta collection.");
}

export async function setTags(ctx: Ctx, ownerId: string, instanceId: number, tags: string[]) {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: ci.id })
      .from(ci)
      .where(and(eq(ci.id, instanceId), eq(ci.ownerId, ownerId)))
      .for("update");
    if (!row) throw notFound("Carte introuvable dans ta collection.");
    await tx.delete(schema.userTags).where(eq(schema.userTags.instanceId, instanceId));
    if (clean.length) await tx.insert(schema.userTags).values(clean.map((tag) => ({ instanceId, tag })));
  });
  return clean;
}

/** Épingle un exemplaire dans la vitrine du profil (emplacement 1 à 5), ou le retire (null). */
export async function setPinned(ctx: Ctx, ownerId: string, instanceId: number, wanted: number | null | "auto") {
  await ctx.db.transaction(async (tx) => {
    await lockPlayer(tx, ownerId);
    let slot = wanted === "auto" ? null : wanted;
    if (wanted === "auto") {
      const used = await tx
        .select({ slot: ci.pinnedSlot })
        .from(ci)
        .where(and(eq(ci.ownerId, ownerId), sql`${ci.pinnedSlot} is not null`));
      const taken = new Set(used.map((u) => u.slot));
      slot = [1, 2, 3, 4, 5].find((s) => !taken.has(s)) ?? null;
      if (slot === null) throw conflict("showcase_full", "Ta vitrine est pleine : retire d'abord une carte.");
    }
    const [inst] = await tx
      .select({ id: ci.id, lockedBy: ci.lockedBy })
      .from(ci)
      .where(and(eq(ci.id, instanceId), eq(ci.ownerId, ownerId)))
      .for("update");
    if (!inst) throw notFound("Carte introuvable dans ta collection.");
    if (slot !== null && inst.lockedBy)
      throw conflict("card_locked", "Une carte en vente ou en échange ne peut pas être épinglée.");
    if (slot !== null) {
      // L'emplacement est libéré s'il était pris par une autre carte.
      await tx
        .update(ci)
        .set({ pinnedSlot: null })
        .where(and(eq(ci.ownerId, ownerId), eq(ci.pinnedSlot, slot)));
    }
    await tx.update(ci).set({ pinnedSlot: slot }).where(eq(ci.id, instanceId));
  });
}

/** Places de la vitrine du profil. */
export const SHOWCASE_SIZE = 5;

/**
 * Remplace toute la vitrine : `instanceIds` dans l'ordre d'affichage (emplacements 1, 2, 3…).
 * Une carte en vente ou en échange peut y rester si elle y était déjà, mais pas y entrer.
 */
export async function setShowcase(ctx: Ctx, ownerId: string, instanceIds: number[]) {
  const ids = [...new Set(instanceIds)];
  if (ids.length !== instanceIds.length) throw badRequest("duplicate", "Une carte ne peut occuper qu'une place.");
  if (ids.length > SHOWCASE_SIZE) throw badRequest("showcase_full", `Ta vitrine tient ${SHOWCASE_SIZE} cartes.`);
  await ctx.db.transaction(async (tx) => {
    await lockPlayer(tx, ownerId);
    const rows = ids.length
      ? await tx
          .select({ id: ci.id, lockedBy: ci.lockedBy, pinnedSlot: ci.pinnedSlot })
          .from(ci)
          .where(and(inArray(ci.id, ids), eq(ci.ownerId, ownerId)))
          .for("update")
      : [];
    if (rows.length !== ids.length) throw notFound("Carte introuvable dans ta collection.");
    if (rows.some((r) => r.lockedBy && r.pinnedSlot === null))
      throw conflict("card_locked", "Une carte en vente ou en échange ne peut pas être épinglée.");
    // Tout est libéré d'abord : l'index unique (joueur, emplacement) ne voit jamais deux cartes au même endroit.
    await tx
      .update(ci)
      .set({ pinnedSlot: null })
      .where(and(eq(ci.ownerId, ownerId), sql`${ci.pinnedSlot} is not null`));
    for (const [i, id] of ids.entries())
      await tx
        .update(ci)
        .set({ pinnedSlot: i + 1 })
        .where(eq(ci.id, id));
  });
  return { instanceIds: ids };
}

/**
 * Recycle des exemplaires en points wiki. Une transaction : joueur verrouillé, exemplaires
 * verrouillés (FOR UPDATE), refus si l'un est engagé dans une enchère ou un échange, ledger.
 */
export async function recycle(ctx: Ctx, ownerId: string, instanceIds: number[]) {
  const ids = [...new Set(instanceIds)];
  if (ids.length === 0) throw badRequest("empty", "Aucune carte à recycler.");
  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, ownerId);
    const rows = await tx
      .select({ id: ci.id, rarity: ci.rarity, shiny: ci.shiny, lockedBy: ci.lockedBy, pinnedSlot: ci.pinnedSlot })
      .from(ci)
      .where(and(inArray(ci.id, ids), eq(ci.ownerId, ownerId)))
      .orderBy(ci.id)
      .for("update");
    if (rows.length !== ids.length) throw notFound("Certaines cartes ne sont plus dans ta collection.");
    if (rows.some((r) => r.lockedBy))
      throw conflict("card_locked", "Une carte est engagée dans une vente ou un échange.");
    if ((await requestedInPendingTrades(tx, ids)).size)
      throw conflict("card_requested", "Une carte est demandée dans un échange en attente : refuse-le d'abord.");
    const gain = rows.reduce((sum, r) => sum + recycleValue(r.rarity, r.shiny), 0);
    await tx.delete(ci).where(inArray(ci.id, ids));
    await logMovement(tx, ownerId, "card", -ids.length, await ownedCount(tx, ownerId), "recycle", ids.join(","));
    await movePw(tx, p, gain, "recycle", ids.join(","));
    return { gain, player: p, rarities: rows.map((r) => r.rarity) };
  });
  pushWallet(ctx, res.player);
  void emit(ctx, ownerId, { type: "recycled", rarities: res.rarities }, "collection");
  return { gain: res.gain, balance: res.player.balance };
}

/**
 * Exemplaires libres d'un joueur (ni engagés, favoris, brillants, épinglés, ni demandés dans un échange en
 * cours), séparés en doublons et en meilleurs exemplaires (meilleur de chaque article : rareté, niveau, puis
 * stats ; le dernier exemplaire d'un article est son meilleur).
 */
export async function freeCopies(
  ctx: Ctx,
  ownerId: string,
  rarities?: Rarity[],
  db: DbOrTx = ctx.db,
): Promise<{ duplicates: { id: number; rarity: Rarity }[]; best: { id: number; rarity: Rarity }[] }> {
  const rows = await db
    .select({
      id: ci.id,
      cardId: ci.cardId,
      rarity: ci.rarity,
      level: ci.level,
      atk: ci.atk,
      def: ci.def,
      shiny: ci.shiny,
      lockedBy: ci.lockedBy,
      favorite: ci.favorite,
      pinned: ci.pinnedSlot,
    })
    .from(ci)
    .where(eq(ci.ownerId, ownerId));
  const best = new Map<number, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = best.get(r.cardId);
    if (!cur || isBetterCopy(r, cur)) best.set(r.cardId, r);
  }
  const free = rows.filter(
    (r) => !r.lockedBy && !r.favorite && !r.shiny && r.pinned === null && (!rarities || rarities.includes(r.rarity)),
  );
  const requested = await requestedInPendingTrades(
    db,
    free.map((r) => r.id),
  );
  const out = { duplicates: [] as { id: number; rarity: Rarity }[], best: [] as { id: number; rarity: Rarity }[] };
  for (const r of free) {
    if (requested.has(r.id)) continue;
    (best.get(r.cardId)?.id === r.id ? out.best : out.duplicates).push({ id: r.id, rarity: r.rarity });
  }
  return out;
}

/** Exemplaires en double (on garde le meilleur de chaque article : rareté, niveau, puis stats). */
export async function duplicateIds(
  ctx: Ctx,
  ownerId: string,
  rarities?: Rarity[],
  db: DbOrTx = ctx.db,
): Promise<{ instanceIds: number[]; gain: number }> {
  const dups = (await freeCopies(ctx, ownerId, rarities, db)).duplicates;
  return { instanceIds: dups.map((r) => r.id), gain: dups.reduce((s, r) => s + recycleValue(r.rarity), 0) };
}

/** Plafond de « Tout sélectionner » (et des actions en masse) : bien au-delà d'une collection réelle. */
export const SELECT_ALL_MAX = 5000;

/** Exemplaire sélectionnable, avec ce qu'il faut pour les actions en masse. */
export interface SelectableItem {
  id: number;
  rarity: Rarity;
  shiny: boolean;
  favorite: boolean;
  /** Jamais recyclé ni fusionné d'office : favori, brillant, épinglé ou engagé (vente, échange, demandé). */
  protected: boolean;
}

/**
 * « Tout sélectionner » : tous les exemplaires qui correspondent aux filtres en cours. Ceux qui sont protégés
 * (favoris, brillantes, épinglés, cartes engagées ou demandées dans un échange) restent sélectionnés pour
 * les favoris et les tags, mais le recyclage les laisse de côté ; `protected` les compte pour l'afficher.
 */
export async function selectableIds(
  ctx: Ctx,
  ownerId: string,
  query: CollectionFilters,
): Promise<{ items: SelectableItem[]; protected: number; truncated: boolean }> {
  const rows = await ctx.db
    .select({
      id: ci.id,
      rarity: ci.rarity,
      shiny: ci.shiny,
      lockedBy: ci.lockedBy,
      favorite: ci.favorite,
      pinned: ci.pinnedSlot,
    })
    .from(ci)
    .innerJoin(c, and(eq(c.season, ci.season), eq(c.id, ci.cardId)))
    .where(and(...collectionWhere(ownerId, query)))
    .orderBy(ci.id)
    .limit(SELECT_ALL_MAX + 1);
  const truncated = rows.length > SELECT_ALL_MAX;
  const page = rows.slice(0, SELECT_ALL_MAX);
  const requested = await requestedInPendingTrades(
    ctx.db,
    page.map((r) => r.id),
  );
  const items = page.map((r) => ({
    id: r.id,
    rarity: r.rarity,
    shiny: r.shiny,
    favorite: r.favorite,
    protected: !!r.lockedBy || r.favorite || r.shiny || r.pinned !== null || requested.has(r.id),
  }));
  return { items, protected: items.filter((i) => i.protected).length, truncated };
}

/** Exemplaires du joueur parmi `ids` (les autres sont ignorés, jamais modifiés). */
async function ownedAmong(tx: DbOrTx, ownerId: string, ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const rows = await tx
    .select({ id: ci.id })
    .from(ci)
    .where(and(inArray(ci.id, ids), eq(ci.ownerId, ownerId)));
  return rows.map((r) => r.id);
}

/** Met en favori (ou retire des favoris) plusieurs exemplaires d'un coup. Renvoie le nombre modifié. */
export async function setFavorites(ctx: Ctx, ownerId: string, instanceIds: number[], favorite: boolean) {
  const ids = [...new Set(instanceIds)];
  if (!ids.length) throw badRequest("empty", "Aucune carte sélectionnée.");
  const rows = await ctx.db
    .update(ci)
    .set({ favorite })
    .where(and(inArray(ci.id, ids), eq(ci.ownerId, ownerId), sql`${ci.favorite} <> ${favorite}`))
    .returning({ id: ci.id });
  return { changed: rows.length };
}

/** Tags par exemplaire au plus (même limite que la fiche carte). */
export const MAX_TAGS_PER_CARD = 10;

/**
 * Ajoute ou retire un tag sur plusieurs exemplaires. Un exemplaire qui a déjà 10 tags n'en reçoit pas
 * de nouveau (`skipped`). Renvoie le nombre d'exemplaires modifiés.
 */
export async function bulkTag(
  ctx: Ctx,
  ownerId: string,
  instanceIds: number[],
  action: { add: string } | { remove: string },
) {
  const ids = [...new Set(instanceIds)];
  if (!ids.length) throw badRequest("empty", "Aucune carte sélectionnée.");
  const tag = ("add" in action ? action.add : action.remove).trim().toLowerCase();
  if (!tag) throw badRequest("empty_tag", "Indique un tag.");
  return ctx.db.transaction(async (tx) => {
    const owned = await ownedAmong(tx, ownerId, ids);
    if (!owned.length) return { changed: 0, skipped: 0 };
    if ("remove" in action) {
      const rows = await tx
        .delete(schema.userTags)
        .where(and(inArray(schema.userTags.instanceId, owned), eq(schema.userTags.tag, tag)))
        .returning({ id: schema.userTags.instanceId });
      return { changed: rows.length, skipped: 0 };
    }
    const counts = await tx
      .select({ id: schema.userTags.instanceId, n: sql<number>`count(*)::int` })
      .from(schema.userTags)
      .where(inArray(schema.userTags.instanceId, owned))
      .groupBy(schema.userTags.instanceId);
    const full = new Set(counts.filter((r) => r.n >= MAX_TAGS_PER_CARD).map((r) => r.id));
    const room = owned.filter((id) => !full.has(id));
    const rows = room.length
      ? await tx
          .insert(schema.userTags)
          .values(room.map((instanceId) => ({ instanceId, tag })))
          .onConflictDoNothing()
          .returning({ id: schema.userTags.instanceId })
      : [];
    // Un exemplaire qui avait déjà ce tag n'est pas « plein » : il est simplement inchangé.
    const already = await tx
      .select({ id: schema.userTags.instanceId })
      .from(schema.userTags)
      .where(and(inArray(schema.userTags.instanceId, [...full]), eq(schema.userTags.tag, tag)));
    return { changed: rows.length, skipped: full.size - (full.size ? already.length : 0) };
  });
}

/**
 * Fusion : un doublon du même article est consommé et la carte cible gagne un niveau (+4 % d'ATK et de DEF,
 * max 5). Une transaction : joueur puis exemplaires verrouillés, ligne de ledger pour l'exemplaire détruit.
 */
export async function fuse(ctx: Ctx, ownerId: string, targetId: number, sourceId: number) {
  if (targetId === sourceId) throw badRequest("same_card", "Choisis un autre exemplaire à fusionner.");
  const res = await ctx.db.transaction(async (tx) => {
    await lockPlayer(tx, ownerId);
    const rows = await tx
      .select()
      .from(ci)
      .where(and(inArray(ci.id, [targetId, sourceId]), eq(ci.ownerId, ownerId)))
      .orderBy(ci.id)
      .for("update");
    const target = rows.find((r) => r.id === targetId);
    const source = rows.find((r) => r.id === sourceId);
    if (!target || !source) throw notFound("Cette carte n'est plus dans ta collection.");
    if (target.cardId !== source.cardId)
      throw badRequest("different_cards", "On ne fusionne que deux exemplaires du même article.");
    if (target.lockedBy || source.lockedBy)
      throw conflict("card_locked", "Une carte est engagée dans une vente ou un échange.");
    if (target.level >= MAX_LEVEL) throw conflict("max_level", `Cette carte est déjà au niveau ${MAX_LEVEL}.`);
    // Sans perte accidentelle : on ne fusionne jamais un exemplaire meilleur (plus rare, plus haut niveau) dans un moins bon.
    if (isBetterCopy(source, target))
      throw conflict("source_better", "Fusionne plutôt dans ton meilleur exemplaire de cette carte.");
    if ((await requestedInPendingTrades(tx, [sourceId])).size)
      throw conflict("card_requested", "Cet exemplaire est demandé dans un échange en attente : refuse-le d'abord.");
    const level = target.level + 1;
    await tx.delete(ci).where(eq(ci.id, sourceId));
    await tx.update(ci).set({ level }).where(eq(ci.id, targetId));
    await logMovement(tx, ownerId, "card", -1, await ownedCount(tx, ownerId), "fusion", `${sourceId}>${targetId}`);
    return { level, ...effectiveStats(target.atk, target.def, level) };
  });
  return { instanceId: targetId, ...res };
}

/** Exemplaires vus par la fusion en masse : tous ceux du joueur, consommables seulement dans les filtres. */
async function fusionCopies(tx: DbOrTx, ownerId: string, query: CollectionFilters, lock: boolean) {
  const base = tx
    .select({
      id: ci.id,
      cardId: ci.cardId,
      rarity: ci.rarity,
      level: ci.level,
      atk: ci.atk,
      def: ci.def,
      shiny: ci.shiny,
      favorite: ci.favorite,
      lockedBy: ci.lockedBy,
      pinned: ci.pinnedSlot,
      inFilter: sql<boolean>`(${and(...collectionWhere(ownerId, query))})`,
    })
    .from(ci)
    .innerJoin(c, and(eq(c.season, ci.season), eq(c.id, ci.cardId)))
    // Seulement les articles possédés en plusieurs exemplaires : une collection entière n'a pas à remonter.
    .where(
      and(
        eq(ci.ownerId, ownerId),
        sql`${ci.cardId} in (select card_id from card_instances where owner_id = ${ownerId} group by card_id having count(*) > 1)`,
      ),
    )
    .orderBy(ci.id);
  const rows = lock ? await base.for("update", { of: ci }) : await base;
  const requested = await requestedInPendingTrades(
    tx,
    rows.map((r) => r.id),
  );
  const copies: FusionCopy[] = rows.map((r) => ({
    id: r.id,
    cardId: r.cardId,
    rarity: r.rarity,
    level: r.level,
    atk: r.atk,
    def: r.def,
    shiny: r.shiny,
    locked: !!r.lockedBy,
    consumable: r.inFilter && !r.favorite && !r.shiny && !r.lockedBy && r.pinned === null && !requested.has(r.id),
  }));
  return { copies, byId: new Map(rows.map((r) => [r.id, r])) };
}

/** Aperçu de la fusion en masse : niveaux gagnés, exemplaires consommés et PW de recyclage auxquels on renonce. */
export async function fusionPreview(ctx: Ctx, ownerId: string, query: CollectionFilters) {
  const { copies, byId } = await fusionCopies(ctx.db, ownerId, query, false);
  const plans = planFusions(copies);
  const sources = plans.flatMap((p) => p.sourceIds);
  return {
    cards: plans.length,
    levels: plans.reduce((s, p) => s + p.toLevel - p.fromLevel, 0),
    consumed: sources.length,
    forgonePw: sources.reduce((s, id) => s + recycleValue(byId.get(id)!.rarity), 0),
    toMax: plans.filter((p) => p.toLevel === MAX_LEVEL).length,
  };
}

/**
 * Fusion en masse des doublons du filtre en cours (même règle que l'aperçu, recalculée sous verrou) :
 * une transaction, joueur puis exemplaires verrouillés, une ligne de ledger pour les exemplaires détruits.
 */
export async function fuseDuplicates(ctx: Ctx, ownerId: string, query: CollectionFilters) {
  const res = await ctx.db.transaction(async (tx) => {
    await lockPlayer(tx, ownerId);
    const { copies } = await fusionCopies(tx, ownerId, query, true);
    const plans = planFusions(copies);
    if (!plans.length) return { plans, consumed: 0 };
    const sources = plans.flatMap((p) => p.sourceIds);
    await tx.delete(ci).where(inArray(ci.id, sources));
    for (const p of plans) await tx.update(ci).set({ level: p.toLevel }).where(eq(ci.id, p.targetId));
    await logMovement(
      tx,
      ownerId,
      "card",
      -sources.length,
      await ownedCount(tx, ownerId),
      "fusion",
      plans
        .map((p) => `${p.sourceIds.join("+")}>${p.targetId}`)
        .join(",")
        .slice(0, 2000),
    );
    return { plans, consumed: sources.length };
  });
  // Succès « Niveau de carte » et « Fusions » : un événement par niveau gagné, comme à l'unité.
  const events = res.plans.flatMap((p) =>
    Array.from({ length: p.toLevel - p.fromLevel }, (_, i) => ({
      type: "card_level" as const,
      level: p.fromLevel + i + 1,
    })),
  );
  if (events.length) void emit(ctx, ownerId, ...events);
  return {
    cards: res.plans.length,
    consumed: res.consumed,
    levels: res.plans.reduce((s, p) => s + p.toLevel - p.fromLevel, 0),
  };
}
