import { eq, schema, sql } from "@palacards/db";
import { CASE_PRICES, REEL_LENGTH, REEL_WIN_INDEX, recycleValue } from "@palacards/game";
import { afterAll, describe, expect, it } from "vitest";
import { makeApp, signUp, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

const season = async () =>
  Number((await ctx.db.execute<{ id: number }>(sql`select id from seasons where status = 'active'`))[0]!.id);

/** Caisse en vente maintenant, remplie de cartes de la saison (`counts` cartes par rareté). */
async function makeCase(
  tier: "bronze" | "silver" | "gold" | "legendary",
  counts: Record<string, number>,
  collection = "Essai",
) {
  const s = await season();
  const [box] = await ctx.db
    .insert(schema.caseBoxes)
    .values({
      collection,
      tier,
      season: s,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  let pos = 0;
  for (const [rarity, n] of Object.entries(counts)) {
    const rows = await ctx.db.execute<{ id: string }>(sql`
      select id from cards where season = ${s} and rarity = ${rarity}::rarity order by views_12m desc limit ${n}
    `);
    expect(rows.length).toBeGreaterThan(0);
    await ctx.db
      .insert(schema.caseCards)
      .values(rows.map((r) => ({ caseId: box!.id, cardId: Number(r.id), rarity: rarity as "UR", pos: pos++ })));
  }
  return {
    id: box!.id,
    size: pos,
    legendaries: Number(
      counts.L
        ? Math.min(
            counts.L,
            (
              await ctx.db.execute<{ n: number }>(
                sql`select count(*)::int n from case_cards where case_id = ${box!.id} and rarity = 'L'`,
              )
            )[0]!.n,
          )
        : 0,
    ),
  };
}

const balance = async (p: Client) => (await p.get("/me")).body.wallet.balance as number;

describe("caisses (suggestion n° 126)", () => {
  it("montre les caisses en vente avec leur contenu, les chances et les caisses gratuites", async () => {
    const { id, size } = await makeCase("gold", { UR: 4, L: 5 }, `Vitrine ${Date.now()}`);
    const p = await signUp(app);
    const res = await p.get("/cases");
    expect(res.status).toBe(200);
    const box = res.body.collections
      .flatMap((c: { cases: { id: number }[] }) => c.cases)
      .find((c: { id: number }) => c.id === id);
    expect(box.price).toBe(CASE_PRICES.gold);
    expect(box.cards).toHaveLength(size);
    // Chances : la somme des cartes seules et des lots fait 1.
    const lots = box.outcomes
      .filter((o: { lot: number }) => o.lot > 1)
      .reduce((s: number, o: { chance: number }) => s + o.chance, 0);
    const singles = box.cards.reduce((s: number, c: { chance: number }) => s + c.chance, 0);
    expect(singles + lots).toBeCloseTo(1, 6);
    expect(box.expectedValue).toBeLessThan(box.price);
    expect(res.body.free).toEqual({ bronze: 0, silver: 0, gold: 0, legendary: 0 });
  });

  it("ouvre une caisse contre des PW : une issue, la bande honnête, la carte dans la collection", async () => {
    const { id } = await makeCase("bronze", { R: 3, SR: 3, UR: 2, L: 1 });
    const p = await signUp(app);
    await p.post("/test/grant-pw", { amount: 1_000 });
    const before = await balance(p);
    const res = await p.post(`/cases/${id}/open`, { count: 1 });
    expect(res.status).toBe(200);
    expect(await balance(p)).toBe(before - CASE_PRICES.bronze);
    const [r] = res.body.results;
    expect(r.tiles).toHaveLength(REEL_LENGTH);
    expect(r.winIndex).toBe(REEL_WIN_INDEX);
    expect(r.cards).toHaveLength(1);
    expect(r.value).toBe(recycleValue(r.cards[0].rarity, !!r.cards[0].shiny));
    // La case gagnante est bien la carte reçue.
    expect(r.tiles[REEL_WIN_INDEX]).toEqual({ kind: "card", cardId: r.cards[0].cardId });
    const [row] = await ctx.db
      .select()
      .from(schema.cardInstances)
      .where(eq(schema.cardInstances.id, r.cards[0].instanceId));
    expect(row!.source).toBe("case");
    expect(row!.ownerId).toBe(p.userId);
    const [opening] = await ctx.db.select().from(schema.caseOpenings).where(eq(schema.caseOpenings.userId, p.userId));
    expect(opening!.price).toBe(CASE_PRICES.bronze);
  });

  it("ouvre cinq caisses d'un coup, refuse sans assez de PW", async () => {
    const { id } = await makeCase("silver", { SR: 3, UR: 3, L: 3 });
    const p = await signUp(app);
    const poor = await p.post(`/cases/${id}/open`, { count: 5 });
    expect(poor.status).toBe(409);
    expect(poor.body.error).toBe("insufficient_pw");
    await p.post("/test/grant-pw", { amount: 5 * CASE_PRICES.silver });
    const res = await p.post(`/cases/${id}/open`, { count: 5 });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(5);
    expect(res.body.results.flatMap((r: { cards: unknown[] }) => r.cards).length).toBeGreaterThanOrEqual(5);
    expect((await p.post(`/cases/${id}/open`, { count: 3 })).status).toBe(400);
  });

  it("utilise une caisse gratuite du même niveau sans toucher aux PW", async () => {
    const { id } = await makeCase("gold", { UR: 3, L: 5 });
    const p = await signUp(app);
    expect((await p.post(`/cases/${id}/open`, { free: true })).body.error).toBe("no_free_case");
    await ctx.db.insert(schema.playerFreeCases).values({ userId: p.userId, tier: "gold", count: 1 });
    const before = await balance(p);
    const res = await p.post(`/cases/${id}/open`, { free: true });
    expect(res.status).toBe(200);
    expect(res.body.usedFree).toBe(true);
    expect(res.body.free.gold).toBe(0);
    expect(await balance(p)).toBe(before);
    expect(res.body.results[0].cards.every((c: { rarity: string }) => c.rarity === "UR" || c.rarity === "L")).toBe(
      true,
    );
  });

  it("donne un lot de légendaires différentes et le montre dans les gros tirages", async () => {
    const { id, legendaries } = await makeCase("legendary", { UR: 2, L: 10 });
    const p = await signUp(app);
    await p.post("/test/grant-pw", { amount: 5 * CASE_PRICES.legendary });
    // Tirage forcé sur le lot de 10 légendaires (dernière issue) puis hasard normal.
    const random = ctx.random;
    let first = true;
    ctx.random = (max: number) => {
      if (first && max === 10_000) {
        first = false;
        return 9_999;
      }
      return random(max);
    };
    try {
      const res = await p.post(`/cases/${id}/open`, { count: 1 });
      expect(res.status).toBe(200);
      const [r] = res.body.results;
      expect(r.lot).toBe(10);
      expect(r.cards).toHaveLength(10);
      // Toutes différentes tant que la caisse en a assez (la saison de test n'en a que quelques-unes).
      expect(new Set(r.cards.map((c: { cardId: number }) => c.cardId)).size).toBe(Math.min(10, legendaries));
      expect(r.tiles[REEL_WIN_INDEX]).toEqual({ kind: "lot", lot: 10 });
      const recent = (await p.get("/cases")).body.recent;
      expect(recent[0]).toMatchObject({ lot: 10, rarity: "L", player: { username: p.username } });
    } finally {
      ctx.random = random;
    }
  });

  it("refuse une caisse qui n'est plus en vente", async () => {
    const { id } = await makeCase("bronze", { R: 2 });
    await ctx.db
      .update(schema.caseBoxes)
      .set({ endsAt: new Date(Date.now() - 1_000), startsAt: new Date(Date.now() - 5_000) })
      .where(eq(schema.caseBoxes.id, id));
    const p = await signUp(app);
    await p.post("/test/grant-pw", { amount: 500 });
    expect((await p.post(`/cases/${id}/open`)).status).toBe(404);
  });

  it("figure dans l'export des données", async () => {
    const p = await signUp(app);
    const res = await p.get("/me/export");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("caseOpenings");
    expect(res.body).toHaveProperty("freeCases");
  });
});
