import { and, desc, eq, inArray, schema, sql, type SQL } from "@palacards/db";
import { ECONOMY, effectiveStats, isBetterCopy, LEVEL_BONUS, MAX_LEVEL, RARITIES, type Rarity } from "@palacards/game";
import type { CardDTO, Page } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { seasonTotals, selectInstances, toCardDTO } from "./cards.js";
import { activeSeason, lockPlayer, logMovement, movePw, ownedCount, pushWallet, type DbOrTx } from "./players.js";

const ci = schema.cardInstances;
const c = schema.cards;

/** Exemplaires demandés dans un échange en attente : ni recyclables ni fusionnables (le destinataire peut refuser l'échange). */
async function requestedInPendingTrades(tx: DbOrTx, ids: number[]): Promise<Set<number>> {
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
  favorites?: boolean;
  duplicates?: boolean;
  q?: string;
  sort: CollectionSort;
  page: number;
  limit: number;
}

/** Filtres de la collection (sans tri ni pagination). */
export type CollectionFilters = Omit<CollectionQuery, "sort" | "page" | "limit">;

/** Conditions SQL des filtres de collection (la requête joint `cards` pour la recherche par titre). */
function collectionWhere(ownerId: string, query: CollectionFilters): SQL[] {
  const where: SQL[] = [eq(ci.ownerId, ownerId)];
  if (query.rarity?.length) where.push(inArray(ci.rarity, query.rarity));
  if (query.season) where.push(eq(ci.season, query.season));
  if (query.favorites) where.push(eq(ci.favorite, true));
  if (query.tag)
    where.push(sql`exists (select 1 from user_tags t where t.instance_id = ${ci.id} and t.tag = ${query.tag})`);
  if (query.duplicates) {
    where.push(
      sql`(select count(*) from card_instances d where d.owner_id = ${ownerId} and d.card_id = ${ci.cardId}) > 1`,
    );
  }
  if (query.q?.trim()) where.push(sql`${c.searchTitle} like '%' || lower(f_unaccent(${query.q.trim()})) || '%'`);
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
  };
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
      .select({ id: ci.id, rarity: ci.rarity, lockedBy: ci.lockedBy, pinnedSlot: ci.pinnedSlot })
      .from(ci)
      .where(and(inArray(ci.id, ids), eq(ci.ownerId, ownerId)))
      .orderBy(ci.id)
      .for("update");
    if (rows.length !== ids.length) throw notFound("Certaines cartes ne sont plus dans ta collection.");
    if (rows.some((r) => r.lockedBy))
      throw conflict("card_locked", "Une carte est engagée dans une vente ou un échange.");
    if ((await requestedInPendingTrades(tx, ids)).size)
      throw conflict("card_requested", "Une carte est demandée dans un échange en attente : refuse-le d'abord.");
    const gain = rows.reduce((sum, r) => sum + ECONOMY.recycleValue[r.rarity], 0);
    await tx.delete(ci).where(inArray(ci.id, ids));
    await logMovement(tx, ownerId, "card", -ids.length, await ownedCount(tx, ownerId), "recycle", ids.join(","));
    await movePw(tx, p, gain, "recycle", ids.join(","));
    return { gain, player: p };
  });
  pushWallet(ctx, res.player);
  return { gain: res.gain, balance: res.player.balance };
}

/** Exemplaires en double (on garde le meilleur de chaque article : rareté, niveau, puis stats). */
export async function duplicateIds(
  ctx: Ctx,
  ownerId: string,
  rarities?: Rarity[],
): Promise<{ instanceIds: number[]; gain: number }> {
  const rows = await ctx.db
    .select({
      id: ci.id,
      cardId: ci.cardId,
      rarity: ci.rarity,
      level: ci.level,
      atk: ci.atk,
      def: ci.def,
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
  const requested = await requestedInPendingTrades(
    ctx.db,
    rows.filter((r) => best.get(r.cardId)?.id !== r.id).map((r) => r.id),
  );
  const dups = rows
    .filter(
      (r) => best.get(r.cardId)?.id !== r.id && !r.lockedBy && !r.favorite && r.pinned === null && !requested.has(r.id),
    )
    .filter((r) => !rarities || rarities.includes(r.rarity));
  return { instanceIds: dups.map((r) => r.id), gain: dups.reduce((s, r) => s + ECONOMY.recycleValue[r.rarity], 0) };
}

/** Plafond de « Tout sélectionner » : bien au-delà d'une collection réelle, borne la réponse. */
export const SELECT_ALL_MAX = 5000;

/**
 * « Tout sélectionner » : exemplaires recyclables qui correspondent aux filtres en cours.
 * Comme pour les doublons, on écarte d'office les favoris, les épinglés et les cartes engagées
 * (vente, échange, demandées dans un échange en attente) ; `protected` les compte pour l'afficher.
 */
export async function selectableIds(
  ctx: Ctx,
  ownerId: string,
  query: CollectionFilters,
): Promise<{ items: { id: number; rarity: Rarity }[]; protected: number; truncated: boolean }> {
  const rows = await ctx.db
    .select({
      id: ci.id,
      rarity: ci.rarity,
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
  const items = page
    .filter((r) => !r.lockedBy && !r.favorite && r.pinned === null && !requested.has(r.id))
    .map((r) => ({ id: r.id, rarity: r.rarity }));
  return { items, protected: page.length - items.length, truncated };
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
