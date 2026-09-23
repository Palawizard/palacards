import { and, desc, eq, inArray, lte, schema, sql, type SQL } from "@palacards/db";
import {
  antiSnipeEnd,
  ECONOMY,
  minNextBid,
  referencePrice,
  saleTax,
  validateListing,
  type Rarity,
} from "@palacards/game";
import type { AuctionDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { instancesByIds } from "./cards.js";
import { afterCommit, Effects } from "./notifications.js";
import {
  lockPlayers,
  logMovement,
  moveLocked,
  movePw,
  ownedCount,
  pushWallet,
  transferInstances,
  type Player,
} from "./players.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type Auction = typeof schema.auctions.$inferSelect;

export const AUCTION_CLOSE_JOB = "auction-close";
export const auctionRoom = (id: number) => `auction:${id}`;
const a = schema.auctions;

async function lockAuction(tx: Tx, auctionId: number): Promise<Auction> {
  const [row] = await tx.select().from(a).where(eq(a.id, auctionId)).for("update");
  if (!row) throw notFound("Cette vente n'existe pas.");
  return row;
}

async function usernames(db: Ctx["db"] | Tx, ids: (string | null)[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter((x): x is string => !!x))];
  if (!clean.length) return new Map();
  const rows = await db
    .select({ id: schema.user.id, name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})` })
    .from(schema.user)
    .where(inArray(schema.user.id, clean));
  return new Map(rows.map((r) => [r.id, r.name]));
}

function pushAuction(ctx: Ctx, auction: Auction, bidderName: string | null) {
  ctx.rt.toRoom(auctionRoom(auction.id), "auction:update", {
    id: auction.id,
    currentBid: auction.currentBid,
    currentBidder: bidderName,
    currentBidderId: auction.currentBidderId,
    bidCount: auction.bidCount,
    endsAt: auction.endsAt.toISOString(),
    status: auction.status,
  });
}

// ---------------------------------------------------------------------------
// Mise en vente
// ---------------------------------------------------------------------------

export async function createAuction(
  ctx: Ctx,
  sellerId: string,
  input: { instanceId: number; startPrice: number; buyout: number | null; durationMs: number },
) {
  const error = validateListing(input.startPrice, input.buyout, input.durationMs);
  if (error === "buyout_below_start") throw badRequest(error, "L'achat immédiat doit être au moins égal à la mise à prix.");
  if (error === "invalid_duration") throw badRequest(error, "Durée de vente invalide.");
  if (error) throw badRequest(error, "Prix invalide.");
  const now = ctx.now();
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const seller = (await lockPlayers(tx, [sellerId])).get(sellerId)!;
    const [inst] = await tx
      .select()
      .from(schema.cardInstances)
      .where(and(eq(schema.cardInstances.id, input.instanceId), eq(schema.cardInstances.ownerId, sellerId)))
      .for("update");
    if (!inst) throw notFound("Cette carte n'est plus dans ta collection.");
    if (inst.lockedBy) throw conflict("card_locked", "Cette carte est déjà engagée dans une vente ou un échange.");
    await tx
      .update(schema.cardInstances)
      .set({ lockedBy: "auction", pinnedSlot: null })
      .where(eq(schema.cardInstances.id, inst.id));
    const [auction] = await tx
      .insert(a)
      .values({
        instanceId: inst.id,
        sellerId,
        cardId: inst.cardId,
        season: inst.season,
        rarity: inst.rarity,
        startPrice: input.startPrice,
        buyout: input.buyout,
        endsAt: new Date(now.getTime() + input.durationMs),
        createdAt: now,
      })
      .returning();
    await movePw(tx, seller, -ECONOMY.auctionListingFee, "market_fee", auction!.id);
    // Wishlist : prévient les joueurs qui attendent cet article (une fois par jour et par article,
    // pour qu'une mise en vente annulée en boucle ne spamme personne).
    const [card] = await tx
      .select({ title: schema.cards.title })
      .from(schema.cards)
      .where(and(eq(schema.cards.season, inst.season), eq(schema.cards.id, inst.cardId)));
    const wishers = await tx
      .select({ userId: schema.wishlist.userId })
      .from(schema.wishlist)
      .where(
        and(
          eq(schema.wishlist.cardId, inst.cardId),
          sql`${schema.wishlist.userId} <> ${sellerId}`,
          sql`not exists (select 1 from notifications n where n.user_id = ${schema.wishlist.userId} and n.type = 'wishlist_listed'
                          and n.payload->>'cardId' = ${String(inst.cardId)} and n.created_at > now() - interval '1 day')`,
        ),
      );
    for (const w of wishers) {
      await fx.notify(tx, w.userId, "wishlist_listed", {
        auctionId: auction!.id,
        cardId: inst.cardId,
        title: card?.title ?? "",
        rarity: inst.rarity,
      });
    }
    return { auction: auction!, seller };
  });
  await afterCommit(ctx, async () => {
    await ctx.jobs.sendAt(AUCTION_CLOSE_JOB, { auctionId: res.auction.id }, res.auction.endsAt);
    pushWallet(ctx, res.seller);
    await fx.flush(ctx);
  });
  return { id: res.auction.id };
}

export async function cancelAuction(ctx: Ctx, sellerId: string, auctionId: number) {
  await ctx.db.transaction(async (tx) => {
    const auction = await lockAuction(tx, auctionId);
    if (auction.sellerId !== sellerId) throw forbidden("Ce n'est pas ta vente.");
    if (auction.status !== "open") throw conflict("auction_closed", "Cette vente est déjà terminée.");
    if (auction.currentBidderId) throw conflict("has_bids", "Impossible d'annuler une vente qui a déjà une offre.");
    await tx.update(a).set({ status: "cancelled", closedAt: ctx.now() }).where(eq(a.id, auctionId));
    await tx.update(schema.cardInstances).set({ lockedBy: null }).where(eq(schema.cardInstances.id, auction.instanceId));
  });
  ctx.rt.toRoom(auctionRoom(auctionId), "auction:update", {
    id: auctionId,
    currentBid: null,
    currentBidder: null,
    currentBidderId: null,
    bidCount: 0,
    endsAt: ctx.now().toISOString(),
    status: "cancelled",
  });
}

// ---------------------------------------------------------------------------
// Enchères et achat immédiat
// ---------------------------------------------------------------------------

/**
 * Règle une vente dans la transaction : le gagnant paie (ses fonds bloqués sont libérés d'abord),
 * le vendeur reçoit le prix moins la taxe de 5 % (détruite), la carte change de main.
 */
async function settle(tx: Tx, fx: Effects, auction: Auction, players: Map<string, Player>, winnerId: string, price: number, lockedAmount: number, now: Date) {
  const winner = players.get(winnerId)!;
  const seller = players.get(auction.sellerId)!;
  await moveLocked(tx, winner, -lockedAmount);
  await movePw(tx, winner, -price, "market_purchase", auction.id);
  await movePw(tx, seller, price, "market_sale", auction.id);
  await movePw(tx, seller, -saleTax(price), "market_tax", auction.id);
  await transferInstances(tx, [auction.instanceId], winnerId, "market");
  await logMovement(tx, winnerId, "card", 1, await ownedCount(tx, winnerId), "market_purchase", auction.id);
  await logMovement(tx, auction.sellerId, "card", -1, await ownedCount(tx, auction.sellerId), "market_sale", auction.id);
  await tx.insert(schema.sales).values({ cardId: auction.cardId, rarity: auction.rarity, price, auctionId: auction.id, soldAt: now });
  await tx
    .update(a)
    .set({ status: "sold", currentBid: price, currentBidderId: winnerId, closedAt: now })
    .where(eq(a.id, auction.id));
  const [card] = await tx
    .select({ title: schema.cards.title })
    .from(schema.cards)
    .where(and(eq(schema.cards.season, auction.season), eq(schema.cards.id, auction.cardId)));
  const payload = { auctionId: auction.id, cardId: auction.cardId, title: card?.title ?? "", price };
  await fx.notify(tx, winnerId, "auction_won", payload);
  await fx.notify(tx, auction.sellerId, "auction_sold", { ...payload, proceeds: price - saleTax(price) });
  return { ...auction, status: "sold" as const, currentBid: price, currentBidderId: winnerId, closedAt: now };
}

export async function placeBid(ctx: Ctx, bidderId: string, auctionId: number, amount: number) {
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const auction = await lockAuction(tx, auctionId);
    // Heure lue sous verrou : une offre en attente ne peut pas passer après la vraie fin.
    const now = ctx.now();
    if (auction.status !== "open" || auction.endsAt <= now) throw conflict("auction_closed", "Cette vente est terminée.");
    if (auction.sellerId === bidderId) throw forbidden("Tu ne peux pas enchérir sur ta propre vente.");
    if (!Number.isInteger(amount) || amount < 1) throw badRequest("bid_too_low", "Offre invalide.");

    // Offre au prix d'achat immédiat ou plus : on achète directement au prix affiché
    // (même si la hausse minimale de 5 % dépasserait ce prix).
    if (auction.buyout !== null && amount >= auction.buyout) {
      const players = await lockPlayers(tx, [bidderId, auction.sellerId, ...(auction.currentBidderId ? [auction.currentBidderId] : [])]);
      if (auction.currentBidderId && auction.currentBidderId !== bidderId) {
        await moveLocked(tx, players.get(auction.currentBidderId)!, -auction.currentBid!);
      }
      const ownLocked = auction.currentBidderId === bidderId ? auction.currentBid! : 0;
      const bidder = players.get(bidderId)!;
      if (bidder.balance - bidder.lockedBalance + ownLocked < auction.buyout) {
        throw conflict("insufficient_funds", "Pas assez de points wiki disponibles.");
      }
      await tx.insert(schema.bids).values({ auctionId, bidderId, amount: auction.buyout, createdAt: now });
      const sold = await settle(tx, fx, { ...auction, bidCount: auction.bidCount + 1 }, players, bidderId, auction.buyout, ownLocked, now);
      if (auction.currentBidderId && auction.currentBidderId !== bidderId) {
        await fx.notify(tx, auction.currentBidderId, "outbid", { auctionId, amount: auction.buyout, bought: true });
      }
      return { auction: { ...sold, bidCount: auction.bidCount + 1 }, players, rescheduled: false };
    }

    const min = minNextBid(auction.startPrice, auction.currentBid);
    if (amount < min) throw badRequest("bid_too_low", `L'offre minimale est de ${min} PW.`);

    const involved = [bidderId, ...(auction.currentBidderId ? [auction.currentBidderId] : [])];
    const players = await lockPlayers(tx, involved);
    const bidder = players.get(bidderId)!;
    if (auction.currentBidderId === bidderId) {
      // Le meilleur enchérisseur relève sa propre offre : on ne bloque que la différence.
      await moveLocked(tx, bidder, amount - auction.currentBid!);
    } else {
      await moveLocked(tx, bidder, amount);
      if (auction.currentBidderId) {
        await moveLocked(tx, players.get(auction.currentBidderId)!, -auction.currentBid!);
        await fx.notify(tx, auction.currentBidderId, "outbid", { auctionId, cardId: auction.cardId, amount });
      }
    }
    const endsAt = antiSnipeEnd(auction.endsAt, now);
    await tx.insert(schema.bids).values({ auctionId, bidderId, amount, createdAt: now });
    const [updated] = await tx
      .update(a)
      .set({ currentBid: amount, currentBidderId: bidderId, bidCount: auction.bidCount + 1, endsAt })
      .where(eq(a.id, auctionId))
      .returning();
    return { auction: updated!, players, rescheduled: endsAt.getTime() !== auction.endsAt.getTime() };
  });
  await afterCommit(ctx, async () => {
    // Prolongation anti-snipe : un nouveau job de clôture ; l'ancien ne fera rien (échéance repoussée).
    if (res.rescheduled) await ctx.jobs.sendAt(AUCTION_CLOSE_JOB, { auctionId }, res.auction.endsAt);
    for (const p of res.players.values()) pushWallet(ctx, p);
    const names = await usernames(ctx.db, [res.auction.currentBidderId]);
    pushAuction(ctx, res.auction, res.auction.currentBidderId ? (names.get(res.auction.currentBidderId) ?? null) : null);
    await fx.flush(ctx);
  });
  return { status: res.auction.status, currentBid: res.auction.currentBid, endsAt: res.auction.endsAt.toISOString() };
}

export async function buyNow(ctx: Ctx, buyerId: string, auctionId: number) {
  const [auction] = await ctx.db.select().from(a).where(eq(a.id, auctionId));
  if (!auction) throw notFound("Cette vente n'existe pas.");
  if (auction.buyout === null) throw badRequest("no_buyout", "Cette vente n'a pas de prix d'achat immédiat.");
  return placeBid(ctx, buyerId, auctionId, auction.buyout);
}

/**
 * Clôture à l'échéance (job pg-boss, idempotent) : ne fait rien si la vente est déjà close
 * ou si l'anti-snipe a repoussé la fin (un autre job est programmé).
 */
export async function closeAuctionIfDue(ctx: Ctx, auctionId: number) {
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const auction = await lockAuction(tx, auctionId);
    const now = ctx.now();
    if (auction.status !== "open" || auction.endsAt > now) return null;
    if (!auction.currentBidderId || auction.currentBid === null) {
      await tx.update(a).set({ status: "expired", closedAt: now }).where(eq(a.id, auctionId));
      await tx.update(schema.cardInstances).set({ lockedBy: null }).where(eq(schema.cardInstances.id, auction.instanceId));
      await fx.notify(tx, auction.sellerId, "auction_expired", { auctionId, cardId: auction.cardId });
      return { auction: { ...auction, status: "expired" as const }, players: new Map<string, Player>() };
    }
    const players = await lockPlayers(tx, [auction.sellerId, auction.currentBidderId]);
    const sold = await settle(tx, fx, auction, players, auction.currentBidderId, auction.currentBid, auction.currentBid, now);
    return { auction: sold, players };
  });
  if (!res) return false;
  await afterCommit(ctx, async () => {
    for (const p of res.players.values()) pushWallet(ctx, p);
    const names = await usernames(ctx.db, [res.auction.currentBidderId]);
    pushAuction(ctx, res.auction, res.auction.currentBidderId ? (names.get(res.auction.currentBidderId) ?? null) : null);
    await fx.flush(ctx);
  });
  return true;
}

/** Filet de sécurité (toutes les minutes) : clôture les ventes échues dont le job aurait été perdu. */
export async function sweepAuctions(ctx: Ctx) {
  const due = await ctx.db
    .select({ id: a.id })
    .from(a)
    .where(and(eq(a.status, "open"), lte(a.endsAt, ctx.now())));
  for (const { id } of due) {
    try {
      await closeAuctionIfDue(ctx, id);
    } catch (err) {
      ctx.log.error({ err, auctionId: id }, "clôture de vente en échec");
    }
  }
  return due.length;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------


async function toDTOs(ctx: Ctx, rows: Auction[]): Promise<AuctionDTO[]> {
  const cards = await instancesByIds(
    ctx.db,
    rows.map((r) => r.instanceId),
  );
  const cardBy = new Map(cards.map((c) => [c.instanceId, c]));
  const names = await usernames(ctx.db, [...rows.map((r) => r.sellerId), ...rows.map((r) => r.currentBidderId)]);
  const refs = await referencePrices(
    ctx,
    rows.map((r) => r.cardId),
  );
  return rows.flatMap((r) => {
    const card = cardBy.get(r.instanceId);
    if (!card) return [];
    return [
      {
        id: r.id,
        card: { ...card, locked: null },
        sellerId: r.sellerId,
        seller: names.get(r.sellerId) ?? "?",
        startPrice: r.startPrice,
        buyout: r.buyout,
        currentBid: r.currentBid,
        currentBidder: r.currentBidderId ? (names.get(r.currentBidderId) ?? null) : null,
        currentBidderId: r.currentBidderId,
        minBid: minNextBid(r.startPrice, r.currentBid),
        bidCount: r.bidCount,
        endsAt: r.endsAt.toISOString(),
        status: r.status,
        reference: refs.get(r.cardId) ?? null,
      },
    ];
  });
}

/** Prix de référence (médiane des 20 dernières ventes) de plusieurs articles. */
export async function referencePrices(ctx: Ctx, cardIds: number[]) {
  const out = new Map<number, ReturnType<typeof referencePrice>>();
  const ids = [...new Set(cardIds)];
  if (!ids.length) return out;
  const rows = await ctx.db.execute<{ card_id: string; prices: number[] }>(sql`
    select card_id, array_agg(price order by sold_at desc) as prices from (
      select card_id, price, sold_at, row_number() over (partition by card_id order by sold_at desc) as rn
      from sales where card_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
    ) s where rn <= ${ECONOMY.referencePriceSampleSize}
    group by card_id
  `);
  for (const r of rows) out.set(Number(r.card_id), referencePrice(r.prices.map(Number)));
  return out;
}

export async function listAuctions(
  ctx: Ctx,
  userId: string,
  q: { rarity?: Rarity[]; sort: "ending" | "recent" | "price"; scope: "all" | "mine" | "bidding"; search?: string },
) {
  const where: SQL[] = [eq(a.status, "open")];
  if (q.rarity?.length) where.push(inArray(a.rarity, q.rarity));
  if (q.scope === "mine") where.push(eq(a.sellerId, userId));
  if (q.scope === "bidding") where.push(sql`exists (select 1 from bids b where b.auction_id = ${a.id} and b.bidder_id = ${userId})`);
  if (q.search?.trim()) {
    where.push(
      sql`exists (select 1 from cards c where c.season = ${a.season} and c.id = ${a.cardId} and lower(f_unaccent(c.title)) like '%' || lower(f_unaccent(${q.search.trim()})) || '%')`,
    );
  }
  const order =
    q.sort === "ending" ? [a.endsAt] : q.sort === "recent" ? [desc(a.createdAt)] : [sql`coalesce(${a.currentBid}, ${a.startPrice}) desc`];
  const rows = await ctx.db
    .select()
    .from(a)
    .where(and(...where))
    .orderBy(...order)
    .limit(200);
  return toDTOs(ctx, rows);
}

export async function auctionDetail(ctx: Ctx, auctionId: number) {
  const [row] = await ctx.db.select().from(a).where(eq(a.id, auctionId));
  if (!row) throw notFound("Cette vente n'existe pas.");
  const [dto] = await toDTOs(ctx, [row]);
  const history = await ctx.db
    .select({ amount: schema.bids.amount, createdAt: schema.bids.createdAt, bidderId: schema.bids.bidderId })
    .from(schema.bids)
    .where(eq(schema.bids.auctionId, auctionId))
    .orderBy(desc(schema.bids.createdAt))
    .limit(50);
  const names = await usernames(
    ctx.db,
    history.map((h) => h.bidderId),
  );
  return {
    ...dto!,
    bids: history.map((h) => ({ amount: h.amount, at: h.createdAt.toISOString(), bidder: names.get(h.bidderId) ?? "?" })),
  };
}

/** Historique des prix d'un article (fiche carte). */
export async function priceHistory(ctx: Ctx, cardId: number) {
  const rows = await ctx.db
    .select({ price: schema.sales.price, soldAt: schema.sales.soldAt, rarity: schema.sales.rarity })
    .from(schema.sales)
    .where(eq(schema.sales.cardId, cardId))
    .orderBy(desc(schema.sales.soldAt))
    .limit(50);
  return {
    reference: referencePrice(rows.map((r) => r.price)),
    sales: rows.map((r) => ({ price: r.price, soldAt: r.soldAt.toISOString(), rarity: r.rarity })),
  };
}
