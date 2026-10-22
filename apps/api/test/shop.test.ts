import { and, eq, schema, sql } from "@palacards/db";
import { SHOP_PRICES, SHOP_SIZE } from "@palacards/game";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "../src/context.js";
import { makeApp, signUp, type Client } from "./helpers.js";

let app: Awaited<ReturnType<typeof makeApp>>["app"];
let ctx: Ctx;
let clock: Ctx["now"];

beforeAll(async () => {
  ({ app, ctx } = await makeApp());
  clock = ctx.now;
});
afterEach(() => {
  ctx.now = clock;
});
afterAll(() => app.close());

async function setBalance(p: Client, balance: number) {
  await ctx.db.update(schema.players).set({ balance }).where(eq(schema.players.userId, p.userId));
}

interface ShopItem {
  slot: number;
  price: number;
  purchased: boolean;
  card: { cardId: number; rarity: "SR" | "UR" | "L"; shiny: boolean; owned: boolean };
}

describe("boutique du jour", () => {
  it("20 cartes différentes de la saison, SR, UR ou L, jamais brillantes, au prix de leur rareté", async () => {
    const p = await signUp(app);
    const shop = (await p.get("/shop")).body;
    expect(shop.items).toHaveLength(SHOP_SIZE);
    const items = shop.items as ShopItem[];
    expect(new Set(items.map((i) => i.card.cardId)).size).toBe(SHOP_SIZE);
    for (const i of items) {
      expect(["SR", "UR", "L"]).toContain(i.card.rarity);
      expect(i.card.shiny).toBe(false);
      expect(i.price).toBe(SHOP_PRICES[i.card.rarity]);
      expect(i.purchased).toBe(false);
    }
    expect(new Date(shop.resetsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("même sélection toute la journée, nouvelle après minuit (heure de Paris), différente d'un joueur à l'autre", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    // 23 h 30 à Paris le 22 octobre (heure d'été : UTC+2), puis 0 h 10 le 23.
    ctx.now = () => new Date("2026-10-22T21:30:00Z");
    const morning = (await a.get("/shop")).body;
    expect(morning.day).toBe("2026-10-22");
    ctx.now = () => new Date("2026-10-22T21:55:00Z");
    expect((await a.get("/shop")).body.items).toEqual(morning.items);
    const other = (await b.get("/shop")).body;
    expect(other.items.map((i: ShopItem) => i.card.cardId)).not.toEqual(
      morning.items.map((i: ShopItem) => i.card.cardId),
    );
    ctx.now = () => new Date("2026-10-22T22:10:00Z");
    const next = (await a.get("/shop")).body;
    expect(next.day).toBe("2026-10-23");
    expect(next.items.map((i: ShopItem) => i.card.cardId)).not.toEqual(
      morning.items.map((i: ShopItem) => i.card.cardId),
    );
  });

  it("achat : PW débités, carte dans la collection (source shop), une seule fois", async () => {
    const p = await signUp(app);
    const item =
      ((await p.get("/shop")).body.items as ShopItem[]).find((i) => i.card.rarity === "SR") ??
      (await p.get("/shop")).body.items[0];
    await setBalance(p, 10_000);
    const res = await p.post("/shop/buy", { slot: item.slot });
    expect(res.status).toBe(200);
    expect(res.body.wallet.balance).toBe(10_000 - item.price);
    const [inst] = await ctx.db
      .select()
      .from(schema.cardInstances)
      .where(eq(schema.cardInstances.id, res.body.instanceId));
    expect(inst).toMatchObject({ ownerId: p.userId, cardId: item.card.cardId, source: "shop", shiny: false });
    const [ledger] = await ctx.db
      .select()
      .from(schema.ledger)
      .where(
        and(
          eq(schema.ledger.userId, p.userId),
          eq(schema.ledger.reason, "shop_purchase"),
          eq(schema.ledger.kind, "pw"),
        ),
      );
    expect(ledger!.delta).toBe(-item.price);

    const again = await p.post("/shop/buy", { slot: item.slot });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_bought");
    const shop = (await p.get("/shop")).body.items as ShopItem[];
    expect(shop.find((i) => i.slot === item.slot)).toMatchObject({ purchased: true, card: { owned: true } });
  });

  it("solde insuffisant : refusé, rien ne bouge", async () => {
    const p = await signUp(app);
    const item = ((await p.get("/shop")).body.items as ShopItem[])[0]!;
    await setBalance(p, item.price - 1);
    const res = await p.post("/shop/buy", { slot: item.slot });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("insufficient_funds");
    const [row] = await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from card_instances where owner_id = ${p.userId} and source = 'shop'`,
    );
    expect(row!.n).toBe(0);
    expect((await p.get("/me")).body.wallet.balance).toBe(item.price - 1);
  });

  it("achats concurrents (double clic) : une seule carte, un seul débit", async () => {
    const p = await signUp(app);
    const item = ((await p.get("/shop")).body.items as ShopItem[])[0]!;
    await setBalance(p, 100_000);
    const results = await Promise.all(Array.from({ length: 5 }, () => p.post("/shop/buy", { slot: item.slot })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    const [row] = await ctx.db.execute<{ n: number; spent: string }>(sql`
      select (select count(*)::int from card_instances where owner_id = ${p.userId} and source = 'shop') as n,
             (select coalesce(sum(delta), 0) from ledger where user_id = ${p.userId} and reason = 'shop_purchase' and kind = 'pw') as spent
    `);
    expect(row!.n).toBe(1);
    expect(Number(row!.spent)).toBe(-item.price);
  });

  it("premières visites simultanées : une seule boutique", async () => {
    const p = await signUp(app);
    const shops = await Promise.all(Array.from({ length: 4 }, () => p.get("/shop")));
    const ids = shops.map((s) => (s.body.items as ShopItem[]).map((i) => i.card.cardId).join(","));
    expect(new Set(ids).size).toBe(1);
  });

  it("une légendaire achetée apparaît dans le fil comme achetée en boutique, sans compter comme un tirage", async () => {
    const p = await signUp(app);
    const items = (await p.get("/shop")).body.items as ShopItem[];
    // Une légendaire en boutique (base de test : 2 légendaires seulement) ; sinon on en place une.
    let slot = items.find((i) => i.card.rarity === "L")?.slot;
    let cardId = items.find((i) => i.card.rarity === "L")?.card.cardId;
    if (slot === undefined) {
      const [l] = await ctx.db.execute<{ id: string }>(sql`
        select id from cards where season = (select id from seasons where status = 'active') and rarity = 'L' limit 1
      `);
      slot = 0;
      cardId = Number(l!.id);
      await ctx.db
        .update(schema.shopOffers)
        .set({ cardId, rarity: "L", price: SHOP_PRICES.L })
        .where(and(eq(schema.shopOffers.userId, p.userId), eq(schema.shopOffers.slot, 0)));
    }
    await setBalance(p, 10_000);
    expect((await p.post("/shop/buy", { slot })).status).toBe(200);
    const [pull] = await ctx.db
      .select()
      .from(schema.pulls)
      .where(and(eq(schema.pulls.userId, p.userId), eq(schema.pulls.cardId, cardId!)));
    expect(pull!.source).toBe("shop");
    const feed = (await p.get("/feed?kind=best")).body;
    expect(feed.items.find((i: { card: { cardId: number } }) => i.card.cardId === cardId)).toMatchObject({
      source: "shop",
    });
  });
});
