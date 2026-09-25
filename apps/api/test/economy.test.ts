import { eq, schema, sql } from "@palacards/db";
import { ECONOMY, saleTax } from "@palacards/game";
import { afterAll, describe, expect, it } from "vitest";
import { closeAuctionIfDue } from "../src/services/market.js";
import { achievementPw, makeApp, signUp, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

const HOUR = 60 * 60_000;

async function giveCard(p: Client): Promise<number> {
  const opened = await p.post("/packs/open");
  return opened.body.cards[0].instanceId;
}
async function givePw(p: Client, amount: number) {
  await ctx.db.transaction(async (tx) => {
    const [pl] = await tx.select().from(schema.players).where(eq(schema.players.userId, p.userId)).for("update");
    const balance = pl!.balance + amount;
    await tx.update(schema.players).set({ balance }).where(eq(schema.players.userId, p.userId));
    await tx.insert(schema.ledger).values({ userId: p.userId, delta: amount, balanceAfter: balance, reason: "admin" });
  });
}
async function wallet(p: Client) {
  return (await p.get("/me")).body.wallet as { balance: number; locked: number; available: number };
}
/** Le solde d'un joueur doit toujours être la somme de ses lignes de ledger en PW. */
async function expectLedgerConsistent(p: Client) {
  const [row] = await ctx.db.execute<{ sum: string; balance: string }>(sql`
    select coalesce((select sum(delta) from ledger where user_id = ${p.userId} and kind = 'pw'), 0) as sum,
           (select balance from players where user_id = ${p.userId}) as balance
  `);
  expect(Number(row!.sum)).toBe(Number(row!.balance));
}

describe("marché", () => {
  it("met en vente (frais de 2 PW, carte verrouillée), enchère, clôture et taxe de 5 %", async () => {
    const seller = await signUp(app);
    const bidder = await signUp(app);
    const instanceId = await giveCard(seller);
    const listed = await seller.post("/market", { instanceId, startPrice: 20, buyout: null, durationMs: HOUR });
    expect(listed.status).toBe(200);
    // Succès (traités en arrière-plan) attendus AVANT de lire le solde, sinon course avec ur_10pct & co.
    const listedBonus = await achievementPw(ctx, seller.userId);
    expect((await wallet(seller)).balance).toBe(ECONOMY.startingBalance - ECONOMY.auctionListingFee + listedBonus);
    // Carte verrouillée : ni recyclage ni seconde vente.
    expect((await seller.post("/collection/recycle", { instanceIds: [instanceId] })).status).toBe(409);
    expect((await seller.post("/market", { instanceId, startPrice: 5, buyout: null, durationMs: HOUR })).status).toBe(
      409,
    );

    expect((await bidder.post(`/market/${listed.body.id}/bid`, { amount: 10 })).body.error).toBe("bid_too_low");
    expect((await bidder.post(`/market/${listed.body.id}/bid`, { amount: 40 })).status).toBe(200);
    expect(await wallet(bidder)).toMatchObject({ locked: 40, available: ECONOMY.startingBalance - 40 });

    await ctx.db
      .update(schema.auctions)
      .set({ endsAt: new Date(Date.now() - 1000) })
      .where(eq(schema.auctions.id, listed.body.id));
    expect(await closeAuctionIfDue(ctx, listed.body.id)).toBe(true);
    expect(await closeAuctionIfDue(ctx, listed.body.id)).toBe(false); // idempotent

    const bonus = { bidder: await achievementPw(ctx, bidder.userId), seller: await achievementPw(ctx, seller.userId) };
    expect(await wallet(bidder)).toEqual({
      balance: ECONOMY.startingBalance - 40 + bonus.bidder,
      locked: 0,
      available: ECONOMY.startingBalance - 40 + bonus.bidder,
    });
    expect((await wallet(seller)).balance).toBe(
      ECONOMY.startingBalance - ECONOMY.auctionListingFee + 40 - saleTax(40) + bonus.seller,
    );
    const [inst] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, instanceId));
    expect(inst).toMatchObject({ ownerId: bidder.userId, lockedBy: null, source: "market" });
    const prices = await bidder.get(`/cards/${inst!.cardId}/prices`);
    expect(prices.body.reference).toMatchObject({ median: 40, count: 1 });
    await expectLedgerConsistent(seller);
    await expectLedgerConsistent(bidder);
  });

  it("rend les fonds bloqués quand on est dépassé et prolonge la fin (anti-snipe)", async () => {
    const seller = await signUp(app);
    const a = await signUp(app);
    const b = await signUp(app);
    const listed = await seller.post("/market", {
      instanceId: await giveCard(seller),
      startPrice: 10,
      buyout: null,
      durationMs: 10 * 60_000,
    });
    const id = listed.body.id;
    await a.post(`/market/${id}/bid`, { amount: 10 });
    // Fin dans 20 s : une offre maintenant prolonge la vente de 60 s (fin à ~80 s).
    await ctx.db
      .update(schema.auctions)
      .set({ endsAt: new Date(Date.now() + 20_000) })
      .where(eq(schema.auctions.id, id));
    const res = await b.post(`/market/${id}/bid`, { amount: 11 });
    expect(new Date(res.body.endsAt).getTime()).toBeGreaterThan(Date.now() + 75_000);
    expect((await wallet(a)).locked).toBe(0);
    expect((await wallet(b)).locked).toBe(11);
    const notif = await a.get("/notifications");
    expect(notif.body.items[0]).toMatchObject({ type: "outbid" });
    // Relancer sa propre offre ne bloque que la différence.
    await b.post(`/market/${id}/bid`, { amount: 20 });
    expect((await wallet(b)).locked).toBe(20);
  });

  it("n'accepte qu'un seul achat immédiat quand deux joueurs achètent le même lot en même temps", async () => {
    const seller = await signUp(app);
    const x = await signUp(app);
    const y = await signUp(app);
    const listed = await seller.post("/market", {
      instanceId: await giveCard(seller),
      startPrice: 10,
      buyout: 50,
      durationMs: HOUR,
    });
    const results = await Promise.all([
      x.post(`/market/${listed.body.id}/buy`),
      y.post(`/market/${listed.body.id}/buy`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const balances = [(await wallet(x)).balance, (await wallet(y)).balance].sort((m, n) => m - n);
    expect(balances).toEqual([ECONOMY.startingBalance - 50, ECONOMY.startingBalance]);
    const [sales] = await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from sales where auction_id = ${listed.body.id}`,
    );
    expect(sales!.n).toBe(1);
    await expectLedgerConsistent(x);
    await expectLedgerConsistent(y);
    await expectLedgerConsistent(seller);
  });

  it("refuse une enchère sans fonds disponibles et sur sa propre vente", async () => {
    const seller = await signUp(app);
    const poor = await signUp(app);
    const listed = await seller.post("/market", {
      instanceId: await giveCard(seller),
      startPrice: 500,
      buyout: null,
      durationMs: HOUR,
    });
    expect((await poor.post(`/market/${listed.body.id}/bid`, { amount: 500 })).body.error).toBe("insufficient_funds");
    expect((await seller.post(`/market/${listed.body.id}/bid`, { amount: 600 })).status).toBe(403);
  });

  it("prévient les joueurs qui ont l'article en wishlist", async () => {
    const seller = await signUp(app);
    const fan = await signUp(app);
    const instanceId = await giveCard(seller);
    const [inst] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, instanceId));
    await fan.put(`/wishlist/${inst!.cardId}`);
    await seller.post("/market", { instanceId, startPrice: 5, buyout: null, durationMs: HOUR });
    const notif = await fan.get("/notifications");
    expect(notif.body.items[0]).toMatchObject({ type: "wishlist_listed" });
    expect(notif.body.unread).toBe(1);
    expect((await fan.post("/notifications/read", {})).body.unread).toBe(0);
  });
});

describe("après le marché et pendant un échange", () => {
  it("recycle ou fusionne une carte achetée ou retirée de la vente", async () => {
    const seller = await signUp(app);
    const buyer = await signUp(app);
    const instanceId = await giveCard(seller);
    const listed = await seller.post("/market", { instanceId, startPrice: 10, buyout: 20, durationMs: HOUR });
    expect((await buyer.post(`/market/${listed.body.id}/buy`)).status).toBe(200);
    expect((await buyer.post("/collection/recycle", { instanceIds: [instanceId] })).status).toBe(200);
    // Vente annulée puis fusion de l'exemplaire (plus faible) dans une nouvelle copie.
    const other = await giveCard(seller);
    const cancelled = await seller.post("/market", {
      instanceId: other,
      startPrice: 10,
      buyout: null,
      durationMs: HOUR,
    });
    expect((await seller.post(`/market/${cancelled.body.id}/cancel`)).status).toBe(200);
    const [row] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, other));
    const copy = await seller.post("/test/grant-card", { cardId: row!.cardId, count: 1 });
    await ctx.db
      .update(schema.cardInstances)
      .set({ level: 2 })
      .where(eq(schema.cardInstances.id, copy.body.instanceIds[0]));
    expect((await seller.post(`/collection/${copy.body.instanceIds[0]}/fuse`, { sourceId: other })).status).toBe(200);
  });

  it("refuse de détruire une carte demandée dans un échange en attente", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const wanted = await giveCard(b);
    const trade = await a.post("/trades", { to: b.username, want: [wanted], givePw: 10 });
    expect(trade.status).toBe(200);
    expect((await b.post("/collection/recycle", { instanceIds: [wanted] })).body.error).toBe("card_requested");
    const [row] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, wanted));
    const copy = await b.post("/test/grant-card", { cardId: row!.cardId, count: 1 });
    await ctx.db
      .update(schema.cardInstances)
      .set({ level: 2 })
      .where(eq(schema.cardInstances.id, copy.body.instanceIds[0]));
    expect((await b.post(`/collection/${copy.body.instanceIds[0]}/fuse`, { sourceId: wanted })).body.error).toBe(
      "card_requested",
    );
    // Le recyclage groupé des doublons l'épargne aussi.
    expect((await b.get("/collection/duplicates")).body.instanceIds ?? []).not.toContain(wanted);
    // Refuser l'échange la libère.
    expect((await b.post(`/trades/${trade.body.id}/decline`)).status).toBe(200);
    expect((await b.post("/collection/recycle", { instanceIds: [wanted] })).status).toBe(200);
  });
});

describe("rattrapage", () => {
  it("clôture les ventes échues et expire les échanges échus", async () => {
    const seller = await signUp(app);
    const other = await signUp(app);
    const listed = await seller.post("/market", {
      instanceId: await giveCard(seller),
      startPrice: 5,
      buyout: null,
      durationMs: HOUR,
    });
    await ctx.db
      .update(schema.auctions)
      .set({ endsAt: new Date(Date.now() - 5000) })
      .where(eq(schema.auctions.id, listed.body.id));
    const trade = await seller.post("/trades", { to: other.username, givePw: 3 });
    await ctx.db
      .update(schema.trades)
      .set({ expiresAt: new Date(Date.now() - 5000) })
      .where(eq(schema.trades.id, trade.body.id));
    const { sweepAuctions } = await import("../src/services/market.js");
    const { sweepTrades } = await import("../src/services/trades.js");
    expect(await sweepAuctions(ctx)).toBeGreaterThanOrEqual(1);
    await sweepTrades(ctx);
    const [auction] = await ctx.db.select().from(schema.auctions).where(eq(schema.auctions.id, listed.body.id));
    const [t] = await ctx.db.select().from(schema.trades).where(eq(schema.trades.id, trade.body.id));
    expect(auction!.status).toBe("expired");
    expect(t!.status).toBe("expired");
    expect((await wallet(seller)).locked).toBe(0);
  });
});

describe("échanges", () => {
  it("échange cartes et PW des deux côtés, avec verrouillage pendant la proposition", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const ca = await giveCard(a);
    const cb = await giveCard(b);
    const proposed = await a.post("/trades", { to: b.username, give: [ca], want: [cb], givePw: 30, wantPw: 5 });
    expect(proposed.status).toBe(200);
    expect(await wallet(a)).toMatchObject({ locked: 30 });
    expect((await a.post("/collection/recycle", { instanceIds: [ca] })).status).toBe(409);
    expect((await b.get("/trades?box=received")).body[0].give[0].instanceId).toBe(ca);

    expect((await a.post(`/trades/${proposed.body.id}/accept`)).status).toBe(403);
    expect((await b.post(`/trades/${proposed.body.id}/accept`)).status).toBe(200);
    const [ia] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, ca));
    const [ib] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, cb));
    expect(ia).toMatchObject({ ownerId: b.userId, lockedBy: null });
    expect(ib!.ownerId).toBe(a.userId);
    const bonusA = await achievementPw(ctx, a.userId);
    expect(await wallet(a)).toEqual({
      balance: ECONOMY.startingBalance - 25 + bonusA,
      locked: 0,
      available: ECONOMY.startingBalance - 25 + bonusA,
    });
    const bonusB = await achievementPw(ctx, b.userId);
    expect((await wallet(b)).balance).toBe(ECONOMY.startingBalance + 25 + bonusB);
    await expectLedgerConsistent(a);
    await expectLedgerConsistent(b);
  });

  it("contre-offre, refus et expiration libèrent tout", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const ca = await giveCard(a);
    const first = await a.post("/trades", { to: b.username, give: [ca], givePw: 10 });
    const counter = await b.post(`/trades/${first.body.id}/counter`, { want: [ca], wantPw: 0, givePw: 5 });
    expect(counter.status).toBe(200);
    expect(await wallet(a)).toMatchObject({ locked: 0 });
    expect(await wallet(b)).toMatchObject({ locked: 5 });
    expect((await a.post(`/trades/${counter.body.id}/decline`)).status).toBe(200);
    expect(await wallet(b)).toMatchObject({ locked: 0 });

    const again = await a.post("/trades", { to: b.username, give: [ca], givePw: 7 });
    await ctx.db
      .update(schema.trades)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.trades.id, again.body.id));
    expect((await b.post(`/trades/${again.body.id}/accept`)).body.error).toBe("trade_closed");
    const { closeTrade } = await import("../src/services/trades.js");
    await closeTrade(ctx, again.body.id, { kind: "expire" });
    expect(await wallet(a)).toMatchObject({ locked: 0 });
    const [inst] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, ca));
    expect(inst!.lockedBy).toBeNull();
  });
});

describe("portefeuille", () => {
  it("donne le bonus de connexion une fois par jour", async () => {
    const p = await signUp(app);
    const first = await p.post("/daily");
    expect(first.body).toEqual({ claimed: true, reward: 20, streak: 1 });
    expect((await p.post("/daily")).body).toEqual({ claimed: false });
    await expectLedgerConsistent(p);
  });

  it("vend un paquet bonus contre 150 PW", async () => {
    const p = await signUp(app);
    expect((await p.post("/packs/buy")).body.error).toBe("insufficient_funds");
    await givePw(p, 200);
    const res = await p.post("/packs/buy");
    expect(res.body.packs.bonus).toBe(1);
    expect((await wallet(p)).balance).toBe(ECONOMY.startingBalance + 200 - ECONOMY.bonusPackPrice);
  });
});

describe("vues cachées sur les cartes des autres (« Plus lu » en duel)", () => {
  it("donne les vues sur ses propres cartes, jamais sur celles d'un autre joueur", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const ca = await giveCard(a);
    const cb = await giveCard(b);
    const hasViews = (c: object) => "views12m" in c;

    // Sa propre collection : vues présentes ; celle d'un autre : absentes.
    expect((await a.get("/collection")).body.items.every(hasViews)).toBe(true);
    const other = await b.get(`/players/${a.username}/collection`);
    expect(other.status).toBe(200);
    expect(other.body.items.length).toBeGreaterThan(0);
    expect(other.body.items.some(hasViews)).toBe(false);

    // Vitrine du profil : vues pour soi seulement.
    expect((await a.post(`/collection/${ca}/pin`, { slot: 1 })).status).toBe(200);
    expect((await a.get(`/players/${a.username}`)).body.showcase.every(hasViews)).toBe(true);
    const seen = (await b.get(`/players/${a.username}`)).body.showcase;
    expect(seen).toHaveLength(1);
    expect(seen.some(hasViews)).toBe(false);

    // Échanges : vues sur ses propres cartes seulement.
    const trade = await a.post("/trades", { to: b.username, give: [ca], want: [cb] });
    expect(trade.status).toBe(200);
    const received = (await b.get("/trades?box=received")).body.find((t: { id: number }) => t.id === trade.body.id);
    expect(hasViews(received.give[0])).toBe(false);
    expect(hasViews(received.want[0])).toBe(true);
    const sent = (await a.get("/trades?box=sent")).body.find((t: { id: number }) => t.id === trade.body.id);
    expect(hasViews(sent.give[0])).toBe(true);
    expect(hasViews(sent.want[0])).toBe(false);
    await a.post(`/trades/${trade.body.id}/cancel`);

    // Marché (public) : jamais de vues.
    const listed = await b.post("/market", { instanceId: cb, startPrice: 20, buyout: null, durationMs: HOUR });
    expect(listed.status).toBe(200);
    expect(hasViews((await a.get(`/market/${listed.body.id}`)).body.card)).toBe(false);
    expect((await a.get("/market")).body.some((x: { card: object }) => hasViews(x.card))).toBe(false);

    // Le catalogue (coupé pendant une question de duel) garde les vues.
    const [card] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, cb));
    expect((await a.get(`/cards/${card!.cardId}`)).body.card).toHaveProperty("views12m");
  });
});
