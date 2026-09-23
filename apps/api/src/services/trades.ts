import { and, desc, eq, inArray, or, schema, sql } from "@palacards/db";
import { TRADE_MAX_CARDS_PER_SIDE, TRADE_TTL_MS } from "@palacards/game";
import type { TradeDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { instancesByIds } from "./cards.js";
import { afterCommit, Effects } from "./notifications.js";
import { lockPlayers, logMovement, moveLocked, movePw, ownedCount, pushWallet, transferInstances, type Player } from "./players.js";
import { findUserByName } from "./profiles.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type Trade = typeof schema.trades.$inferSelect;

export const TRADE_EXPIRE_JOB = "trade-expire";
const t = schema.trades;
const ci = schema.cardInstances;

export interface TradeOffer {
  toUsername: string;
  give: number[];
  want: number[];
  givePw: number;
  wantPw: number;
  message?: string;
}

async function lockTrade(tx: Tx, tradeId: number): Promise<Trade> {
  const [row] = await tx.select().from(t).where(eq(t.id, tradeId)).for("update");
  if (!row) throw notFound("Cet échange n'existe pas.");
  return row;
}

/** Libère ce que l'offreur avait engagé (cartes et PW) sur un échange qui n'aboutit pas. */
async function release(tx: Tx, trade: Trade, from: Player) {
  const items = await tx.select().from(schema.tradeItems).where(and(eq(schema.tradeItems.tradeId, trade.id), eq(schema.tradeItems.side, "from")));
  if (items.length) {
    await tx
      .update(ci)
      .set({ lockedBy: null })
      .where(and(inArray(ci.id, items.map((i) => i.instanceId)), eq(ci.ownerId, trade.fromId), eq(ci.lockedBy, "trade")));
  }
  await moveLocked(tx, from, -trade.fromPw);
}

async function createTrade(tx: Tx, fx: Effects, fromId: string, toId: string, offer: Omit<TradeOffer, "toUsername">, now: Date, parentId: number | null) {
  const give = [...new Set(offer.give)];
  const want = [...new Set(offer.want)];
  if (fromId === toId) throw badRequest("self_trade", "Tu ne peux pas échanger avec toi-même.");
  if (give.length > TRADE_MAX_CARDS_PER_SIDE || want.length > TRADE_MAX_CARDS_PER_SIDE) {
    throw badRequest("too_many_cards", `${TRADE_MAX_CARDS_PER_SIDE} cartes maximum de chaque côté.`);
  }
  if (!give.length && !want.length && !offer.givePw && !offer.wantPw) throw badRequest("empty_trade", "L'échange est vide.");

  const players = await lockPlayers(tx, [fromId, toId]);
  const from = players.get(fromId)!;
  const all = [...give, ...want].sort((x, y) => x - y);
  const rows = all.length ? await tx.select().from(ci).where(inArray(ci.id, all)).orderBy(ci.id).for("update") : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of give) {
    const r = byId.get(id);
    if (!r || r.ownerId !== fromId) throw notFound("Une des cartes proposées n'est plus dans ta collection.");
    if (r.lockedBy) throw conflict("card_locked", "Une des cartes proposées est déjà engagée ailleurs.");
  }
  for (const id of want) {
    const r = byId.get(id);
    if (!r || r.ownerId !== toId) throw notFound("Une des cartes demandées n'appartient plus à ce joueur.");
  }
  await moveLocked(tx, from, offer.givePw);
  if (give.length) await tx.update(ci).set({ lockedBy: "trade", pinnedSlot: null }).where(inArray(ci.id, give));
  const [trade] = await tx
    .insert(t)
    .values({
      fromId,
      toId,
      fromPw: offer.givePw,
      toPw: offer.wantPw,
      message: offer.message?.trim() || null,
      parentId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + TRADE_TTL_MS),
    })
    .returning();
  const items = [...give.map((id) => ({ side: "from" as const, id })), ...want.map((id) => ({ side: "to" as const, id }))];
  if (items.length) {
    await tx.insert(schema.tradeItems).values(items.map((i) => ({ tradeId: trade!.id, instanceId: i.id, side: i.side })));
  }
  await fx.notify(tx, toId, parentId ? "trade_countered" : "trade_received", { tradeId: trade!.id, fromId });
  return { trade: trade!, from };
}

export async function proposeTrade(ctx: Ctx, fromId: string, offer: TradeOffer) {
  const target = await findUserByName(ctx.db, offer.toUsername);
  const fx = new Effects();
  const res = await ctx.db.transaction((tx) => createTrade(tx, fx, fromId, target.id, offer, ctx.now(), null));
  await afterCommit(ctx, async () => {
    await ctx.jobs.sendAt(TRADE_EXPIRE_JOB, { tradeId: res.trade.id }, res.trade.expiresAt);
    pushWallet(ctx, res.from);
    await fx.flush(ctx);
  });
  return { id: res.trade.id };
}

/** Contre-offre : clôt la proposition reçue et en envoie une nouvelle dans l'autre sens. */
export async function counterTrade(ctx: Ctx, userId: string, tradeId: number, offer: Omit<TradeOffer, "toUsername">) {
  const fx = new Effects();
  const now = ctx.now();
  const res = await ctx.db.transaction(async (tx) => {
    const trade = await lockTrade(tx, tradeId);
    if (trade.toId !== userId) throw forbidden("Seul le destinataire peut faire une contre-offre.");
    if (trade.status !== "pending" || trade.expiresAt <= now) throw conflict("trade_closed", "Cet échange n'est plus en attente.");
    const players = await lockPlayers(tx, [trade.fromId, trade.toId]);
    await release(tx, trade, players.get(trade.fromId)!);
    await tx.update(t).set({ status: "countered", resolvedAt: now }).where(eq(t.id, tradeId));
    const created = await createTrade(tx, fx, userId, trade.fromId, offer, now, trade.id);
    return { ...created, previousFrom: players.get(trade.fromId)! };
  });
  await afterCommit(ctx, async () => {
    await ctx.jobs.sendAt(TRADE_EXPIRE_JOB, { tradeId: res.trade.id }, res.trade.expiresAt);
    pushWallet(ctx, res.from);
    pushWallet(ctx, res.previousFrom);
    await fx.flush(ctx);
  });
  return { id: res.trade.id };
}

export async function acceptTrade(ctx: Ctx, userId: string, tradeId: number) {
  const fx = new Effects();
  const now = ctx.now();
  const res = await ctx.db.transaction(async (tx) => {
    const trade = await lockTrade(tx, tradeId);
    if (trade.toId !== userId) throw forbidden("Seul le destinataire peut accepter.");
    if (trade.status !== "pending" || trade.expiresAt <= now) throw conflict("trade_closed", "Cet échange n'est plus en attente.");
    const players = await lockPlayers(tx, [trade.fromId, trade.toId]);
    const from = players.get(trade.fromId)!;
    const to = players.get(trade.toId)!;
    const items = await tx.select().from(schema.tradeItems).where(eq(schema.tradeItems.tradeId, tradeId));
    const ids = items.map((i) => i.instanceId).sort((x, y) => x - y);
    const rows = ids.length ? await tx.select().from(ci).where(inArray(ci.id, ids)).orderBy(ci.id).for("update") : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const give = items.filter((i) => i.side === "from").map((i) => i.instanceId);
    const want = items.filter((i) => i.side === "to").map((i) => i.instanceId);
    for (const id of give) {
      const r = byId.get(id);
      if (!r || r.ownerId !== trade.fromId || r.lockedBy !== "trade") throw conflict("trade_invalid", "Une carte proposée n'est plus disponible.");
    }
    for (const id of want) {
      const r = byId.get(id);
      if (!r || r.ownerId !== trade.toId) throw conflict("trade_invalid", "Tu ne possèdes plus une des cartes demandées.");
      if (r.lockedBy) throw conflict("card_locked", "Une des cartes demandées est engagée dans une vente ou un échange.");
    }
    // PW : l'offreur paie ce qu'il avait bloqué, le destinataire paie ce qui lui est demandé.
    await moveLocked(tx, from, -trade.fromPw);
    await movePw(tx, from, -trade.fromPw, "trade", tradeId);
    await movePw(tx, to, trade.fromPw, "trade", tradeId);
    await movePw(tx, to, -trade.toPw, "trade", tradeId);
    await movePw(tx, from, trade.toPw, "trade", tradeId);
    await transferInstances(tx, give, trade.toId, "trade");
    await transferInstances(tx, want, trade.fromId, "trade");
    // Cartes : une ligne par sens (sortie puis entrée) pour chaque joueur.
    const fromCount = await ownedCount(tx, trade.fromId);
    const toCount = await ownedCount(tx, trade.toId);
    await logMovement(tx, trade.fromId, "card", -give.length, fromCount - want.length, "trade", tradeId);
    await logMovement(tx, trade.fromId, "card", want.length, fromCount, "trade", tradeId);
    await logMovement(tx, trade.toId, "card", -want.length, toCount - give.length, "trade", tradeId);
    await logMovement(tx, trade.toId, "card", give.length, toCount, "trade", tradeId);
    await tx.update(t).set({ status: "accepted", resolvedAt: now }).where(eq(t.id, tradeId));
    await fx.notify(tx, trade.fromId, "trade_accepted", { tradeId, byId: userId });
    return { from, to };
  });
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.from);
    pushWallet(ctx, res.to);
    await fx.flush(ctx);
  });
  return { ok: true };
}

/** Refus (destinataire), annulation (offreur) ou expiration (job) : tout est libéré. */
export async function closeTrade(ctx: Ctx, tradeId: number, action: { by: string; kind: "decline" | "cancel" } | { kind: "expire" }) {
  const fx = new Effects();
  const now = ctx.now();
  const res = await ctx.db.transaction(async (tx) => {
    const trade = await lockTrade(tx, tradeId);
    if (trade.status !== "pending") {
      if (action.kind === "expire") return null;
      throw conflict("trade_closed", "Cet échange n'est plus en attente.");
    }
    if (action.kind === "expire" && trade.expiresAt > now) return null;
    if (action.kind === "decline" && trade.toId !== action.by) throw forbidden("Seul le destinataire peut refuser.");
    if (action.kind === "cancel" && trade.fromId !== action.by) throw forbidden("Seul l'offreur peut annuler.");
    const players = await lockPlayers(tx, [trade.fromId]);
    const from = players.get(trade.fromId)!;
    await release(tx, trade, from);
    const status = action.kind === "decline" ? "declined" : action.kind === "cancel" ? "cancelled" : "expired";
    await tx.update(t).set({ status, resolvedAt: now }).where(eq(t.id, tradeId));
    if (action.kind === "decline") await fx.notify(tx, trade.fromId, "trade_declined", { tradeId });
    if (action.kind === "expire") {
      await fx.notify(tx, trade.fromId, "trade_expired", { tradeId });
      await fx.notify(tx, trade.toId, "trade_expired", { tradeId });
    }
    return from;
  });
  await afterCommit(ctx, async () => {
    if (res) pushWallet(ctx, res);
    await fx.flush(ctx);
  });
}


export async function listTrades(ctx: Ctx, userId: string, box: "received" | "sent" | "history"): Promise<TradeDTO[]> {
  const where =
    box === "received"
      ? and(eq(t.toId, userId), eq(t.status, "pending"))
      : box === "sent"
        ? and(eq(t.fromId, userId), eq(t.status, "pending"))
        : and(or(eq(t.fromId, userId), eq(t.toId, userId)), sql`${t.status} <> 'pending'`);
  const trades = await ctx.db.select().from(t).where(where).orderBy(desc(t.createdAt)).limit(100);
  if (!trades.length) return [];
  const items = await ctx.db.select().from(schema.tradeItems).where(inArray(schema.tradeItems.tradeId, trades.map((x) => x.id)));
  const cards = await instancesByIds(ctx.db, [...new Set(items.map((i) => i.instanceId))]);
  const cardBy = new Map(cards.map((c) => [c.instanceId, c]));
  const users = await ctx.db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})`,
    })
    .from(schema.user)
    .where(inArray(schema.user.id, [...new Set(trades.flatMap((x) => [x.fromId, x.toId]))]));
  const userBy = new Map(users.map((u) => [u.id, u]));
  const person = (id: string) => ({ id, name: userBy.get(id)?.name ?? "?", username: userBy.get(id)?.username ?? "" });
  return trades.map((x) => {
    const side = (s: "from" | "to") =>
      items.filter((i) => i.tradeId === x.id && i.side === s).flatMap((i) => (cardBy.get(i.instanceId) ? [cardBy.get(i.instanceId)!] : []));
    return {
      id: x.id,
      from: person(x.fromId),
      to: person(x.toId),
      give: side("from"),
      want: side("to"),
      fromPw: x.fromPw,
      toPw: x.toPw,
      message: x.message,
      status: x.status,
      parentId: x.parentId,
      createdAt: x.createdAt.toISOString(),
      expiresAt: x.expiresAt.toISOString(),
      resolvedAt: x.resolvedAt?.toISOString() ?? null,
    };
  });
}

/** Filet de sécurité : expire les échanges échus dont le job aurait été perdu. */
export async function sweepTrades(ctx: Ctx) {
  const due = await ctx.db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.status, "pending"), sql`${t.expiresAt} <= ${ctx.now()}`));
  for (const { id } of due) {
    try {
      await closeTrade(ctx, id, { kind: "expire" });
    } catch (err) {
      ctx.log.error({ err, tradeId: id }, "expiration d'échange en échec");
    }
  }
}
