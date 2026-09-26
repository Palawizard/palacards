import { eq, schema } from "@palacards/db";
import { afterAll, describe, expect, it } from "vitest";
import { makeApp, signUp } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

describe("wishlist", () => {
  it("liste les cartes suivies, avec leur état de mise en vente", async () => {
    const seller = await signUp(app);
    const fan = await signUp(app);
    const opened = await seller.post("/packs/open");
    const instanceId: number = opened.body.cards[0].instanceId;
    const [inst] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, instanceId));
    const cardId = inst!.cardId;

    expect((await fan.get("/wishlist")).body).toEqual([]);
    expect((await fan.put(`/wishlist/${cardId}`)).body).toEqual({ wishlisted: true });
    const before = await fan.get("/wishlist");
    expect(before.status).toBe(200);
    expect(before.body).toHaveLength(1);
    expect(before.body[0]).toMatchObject({ cardId, onSale: null, owned: false });

    const listed = await seller.post("/market", { instanceId, startPrice: 5, buyout: null, durationMs: 60 * 60_000 });
    expect((await fan.get("/wishlist")).body[0]).toMatchObject({ cardId, onSale: listed.body.id });
  });
});
