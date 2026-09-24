import { ECONOMY, MAX_PRICE, RARITIES, TRADE_MAX_CARDS_PER_SIDE } from "@palacards/game";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import { buyBonusPack, claimDaily, ledgerHistory, listWishlist, setWishlist } from "../services/economy.js";
import {
  auctionDetail,
  auctionRoom,
  buyNow,
  cancelAuction,
  createAuction,
  listAuctions,
  placeBid,
  priceHistory,
} from "../services/market.js";
import { listCollection } from "../services/collection.js";
import { listNotifications, markRead } from "../services/notifications.js";
import { findUserByName } from "../services/profiles.js";
import { acceptTrade, closeTrade, counterTrade, listTrades, proposeTrade } from "../services/trades.js";

const id = z.coerce.number().int().positive();
const idParams = z.object({ id });
const price = z.number().int().min(1).max(MAX_PRICE);
const offer = z.object({
  give: z.array(z.number().int().positive()).max(TRADE_MAX_CARDS_PER_SIDE).default([]),
  want: z.array(z.number().int().positive()).max(TRADE_MAX_CARDS_PER_SIDE).default([]),
  givePw: z.number().int().min(0).max(MAX_PRICE).default(0),
  wantPw: z.number().int().min(0).max(MAX_PRICE).default(0),
  message: z.string().trim().max(280).optional(),
});

export function economyRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };
  const limited = (max: number) => ({ ...auth, config: { rateLimit: { max, timeWindow: "1 minute" } } });

  // --- Marché ---
  api.get("/market", auth, async (req) => {
    const q = parse(
      z.object({
        rarity: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(",") : undefined))
          .pipe(z.array(z.enum(RARITIES)).optional()),
        sort: z.enum(["ending", "recent", "price"]).default("ending"),
        scope: z.enum(["all", "mine", "bidding"]).default("all"),
        q: z.string().max(100).optional(),
      }),
      req.query,
    );
    return listAuctions(ctx, req.user.id, { ...q, search: q.q });
  });
  api.get("/market/:id", auth, async (req) => auctionDetail(ctx, parse(idParams, req.params).id));
  api.post("/market", limited(20), async (req) => {
    const body = parse(
      z.object({
        instanceId: id,
        startPrice: price,
        buyout: price.nullable().default(null),
        durationMs: z
          .number()
          .int()
          .refine((v) => (ECONOMY.auctionDurationsMs as readonly number[]).includes(v), "Durée invalide"),
      }),
      req.body,
    );
    return createAuction(ctx, req.user.id, body);
  });
  api.post("/market/:id/bid", limited(60), async (req) => {
    const { amount } = parse(z.object({ amount: price }), req.body);
    return placeBid(ctx, req.user.id, parse(idParams, req.params).id, amount);
  });
  api.post("/market/:id/buy", limited(30), async (req) => buyNow(ctx, req.user.id, parse(idParams, req.params).id));
  api.post("/market/:id/cancel", auth, async (req) => {
    await cancelAuction(ctx, req.user.id, parse(idParams, req.params).id);
    return { ok: true };
  });
  api.get("/cards/:id/prices", auth, async (req) => priceHistory(ctx, parse(idParams, req.params).id));

  // Salles Socket.IO par enchère : le client s'abonne aux ventes qu'il affiche.
  ctx.rt.onConnection((socket) => {
    socket.on("auction:watch", (raw) => {
      const r = id.safeParse(raw);
      // Plafond de salles par connexion : pas d'abonnement illimité.
      if (r.success && socket.rooms.size < 300) void socket.join(auctionRoom(r.data));
    });
    socket.on("auction:unwatch", (raw) => {
      const r = id.safeParse(raw);
      if (r.success) void socket.leave(auctionRoom(r.data));
    });
  });

  // --- Échanges ---
  api.get("/trades", auth, async (req) => {
    const { box } = parse(z.object({ box: z.enum(["received", "sent", "history"]).default("received") }), req.query);
    return listTrades(ctx, req.user.id, box);
  });
  api.post("/trades", limited(20), async (req) => {
    const body = parse(offer.extend({ to: z.string().trim().min(1).max(30) }), req.body);
    return proposeTrade(ctx, req.user.id, { ...body, toUsername: body.to });
  });
  api.post("/trades/:id/accept", auth, async (req) => acceptTrade(ctx, req.user.id, parse(idParams, req.params).id));
  api.post("/trades/:id/decline", auth, async (req) => {
    await closeTrade(ctx, parse(idParams, req.params).id, { by: req.user.id, kind: "decline" });
    return { ok: true };
  });
  api.post("/trades/:id/cancel", auth, async (req) => {
    await closeTrade(ctx, parse(idParams, req.params).id, { by: req.user.id, kind: "cancel" });
    return { ok: true };
  });
  api.post("/trades/:id/counter", limited(20), async (req) =>
    counterTrade(ctx, req.user.id, parse(idParams, req.params).id, parse(offer, req.body)),
  );

  // Collection d'un joueur (composer un échange, collections de guilde) : sans tags, favoris ni vues.
  api.get("/players/:username/collection", auth, async (req) => {
    const { username } = parse(z.object({ username: z.string().min(1).max(30) }), req.params);
    const q = parse(
      z.object({
        q: z.string().max(100).optional(),
        rarity: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(",") : undefined))
          .pipe(z.array(z.enum(RARITIES)).optional()),
        page: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const owner = await findUserByName(ctx.db, username);
    // Sans vues (« Plus lu » en duel) : listCollection ne les donne qu'au propriétaire.
    const res = await listCollection(ctx, owner.id, { ...q, sort: "rarity", limit: 60 }, req.user.id);
    return { ...res, items: res.items.map(({ tags: _t, favorite: _f, views12m: _v, ...c }) => c) };
  });

  // --- Wishlist ---
  api.get("/wishlist", auth, async (req) => listWishlist(ctx, req.user.id));
  api.put("/wishlist/:id", auth, async (req) => setWishlist(ctx, req.user.id, parse(idParams, req.params).id, true));
  api.delete("/wishlist/:id", auth, async (req) =>
    setWishlist(ctx, req.user.id, parse(idParams, req.params).id, false),
  );

  // --- Notifications ---
  api.get("/notifications", auth, async (req) => {
    const { before } = parse(z.object({ before: id.optional() }), req.query);
    return listNotifications(ctx, req.user.id, before);
  });
  api.post("/notifications/read", auth, async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }), req.body ?? {});
    return markRead(ctx, req.user.id, ids);
  });

  // --- Portefeuille ---
  api.post("/daily", auth, async (req) => claimDaily(ctx, req.user.id));
  api.post("/packs/buy", limited(20), async (req) => buyBonusPack(ctx, req.user.id));
  api.get("/wallet/history", auth, async (req) => ledgerHistory(ctx, req.user.id));
}
