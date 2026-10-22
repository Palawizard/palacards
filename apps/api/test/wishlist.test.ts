import { and, eq, schema, sql } from "@palacards/db";
import { afterAll, describe, expect, it } from "vitest";
import { makeApp, signUp } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

describe("wishlist", () => {
  it("liste les cartes suivies, avec leur état de mise en vente", async () => {
    const seller = await signUp(app);
    const fan = await signUp(app);
    const opened = await seller.post("/packs/open");
    // Base partagée entre fichiers : on prend une carte du paquet que personne d'autre ne vend déjà.
    let instanceId = 0;
    let cardId = 0;
    for (const card of opened.body.cards as { instanceId: number }[]) {
      const [inst] = await ctx.db
        .select()
        .from(schema.cardInstances)
        .where(eq(schema.cardInstances.id, card.instanceId));
      const open = await ctx.db
        .select({ id: schema.auctions.id })
        .from(schema.auctions)
        .where(and(eq(schema.auctions.cardId, inst!.cardId), eq(schema.auctions.status, "open")));
      if (open.length === 0) {
        instanceId = card.instanceId;
        cardId = inst!.cardId;
        break;
      }
    }
    expect(cardId).toBeGreaterThan(0);

    expect((await fan.get("/wishlist")).body).toEqual([]);
    expect((await fan.put(`/wishlist/${cardId}`)).body).toEqual({ wishlisted: true });
    const before = await fan.get("/wishlist");
    expect(before.status).toBe(200);
    expect(before.body).toHaveLength(1);
    expect(before.body[0]).toMatchObject({ cardId, onSale: null, owned: false });

    const listed = await seller.post("/market", { instanceId, startPrice: 5, buyout: null, durationMs: 60 * 60_000 });
    expect((await fan.get("/wishlist")).body[0]).toMatchObject({ cardId, onSale: listed.body.id });
  });

  it("le recyclage automatique garde les cartes de la wishlist, sans créditer de PW", async () => {
    const p = await signUp(app);
    expect((await p.patch("/me/settings", { autoRecycleMax: "SR", autoRecycleKeepNew: false })).status).toBe(200);
    // Toute la base jusqu'à Super rare dans la wishlist : aucune carte du paquet ne peut partir au recyclage.
    await ctx.db.execute(sql`
      insert into wishlist (user_id, card_id)
      select distinct ${p.userId}, id from cards where rarity in ('C', 'PC', 'R', 'SR')
      on conflict do nothing
    `);

    const res = await p.post("/packs/open");
    expect(res.status).toBe(200);
    const cards = res.body.cards as { instanceId: number; rarity: string; shiny: boolean }[];
    const eligible = cards.filter((c) => !c.shiny && ["C", "PC", "R", "SR"].includes(c.rarity));
    expect(res.body.autoRecycled).toBeUndefined();
    expect(res.body.wishlistKept ?? []).toEqual(eligible.map((c) => c.instanceId));

    const owned = await ctx.db
      .select({ id: schema.cardInstances.id })
      .from(schema.cardInstances)
      .where(eq(schema.cardInstances.ownerId, p.userId));
    expect(owned).toHaveLength(cards.length);
    const recycled = await ctx.db
      .select()
      .from(schema.ledger)
      .where(and(eq(schema.ledger.userId, p.userId), eq(schema.ledger.reason, "recycle")));
    expect(recycled).toEqual([]);
  });
});
