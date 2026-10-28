import { eq, schema, sql } from "@palacards/db";
import { ECONOMY, PORTFOLIO_MAX, PORTFOLIO_PRICES } from "@palacards/game";
import { afterAll, describe, expect, it } from "vitest";
import { makeApp, signUp, signUpAdmin, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAALklEQVR4nO3NMQEAMAgAoLk0ZjKxsazg5wMFiM56F/7JKhaLxWKxWCwWi8XilQH91QGGD5y0UgAAAABJRU5ErkJggg==";

/** Joueur avec un paquet ouvert ; renvoie ses exemplaires. */
async function withCards(p: Client): Promise<number[]> {
  const opened = await p.post("/packs/open");
  return opened.body.cards.map((c: { instanceId: number }) => c.instanceId);
}
async function create(p: Client, name = "Mes favorites") {
  const res = await p.post("/portfolios", { name });
  expect(res.status).toBe(200);
  return res.body.id as number;
}
async function givePw(p: Client, amount: number) {
  await p.post("/test/grant-pw", { amount });
}

describe("portfolios (suggestions n° 3 et 116)", () => {
  it("crée un portfolio de cartes possédées, en ordre, avec une carte en vedette", async () => {
    const p = await signUp(app);
    const [a, b, c] = await withCards(p);
    const id = await create(p);
    const res = await p.put(`/portfolios/${id}/cards`, {
      cards: [{ instanceId: c }, { instanceId: a, featured: true }, { instanceId: b, featured: true }],
    });
    expect(res.status).toBe(200);
    expect(res.body.cards.map((x: { instanceId: number; featured: boolean }) => [x.instanceId, x.featured])).toEqual([
      [c, false],
      [a, true],
      [b, false],
    ]);
    // Aperçu : la carte en vedette d'abord.
    expect(res.body.preview[0].instanceId).toBe(a);
    // Une carte d'un autre joueur est refusée ; une même carte peut aller dans plusieurs portfolios.
    const other = await signUp(app);
    const [theirs] = await withCards(other);
    expect((await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: theirs }] })).status).toBe(404);
    const second = await create(p, "Deuxième");
    expect((await p.put(`/portfolios/${second}/cards`, { cards: [{ instanceId: a }] })).status).toBe(200);
    expect((await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: a }, { instanceId: a }] })).status).toBe(
      400,
    );
  });

  it("limite à 30 cartes et au garde-fou de portfolios", async () => {
    const p = await signUp(app);
    const id = await create(p);
    const many = Array.from({ length: 31 }, (_, i) => ({ instanceId: i + 1 }));
    expect((await p.put(`/portfolios/${id}/cards`, { cards: many })).status).toBe(400);
    await ctx.db
      .insert(schema.portfolios)
      .values(Array.from({ length: PORTFOLIO_MAX - 1 }, (_, i) => ({ userId: p.userId, name: `P${i}` })));
    const refused = await p.post("/portfolios", { name: "Un de trop" });
    expect(refused.body.error).toBe("portfolio_limit");
  });

  it("retire proprement une carte recyclée, fusionnée, upgradée, vendue ou échangée", async () => {
    const p = await signUp(app);
    const buyer = await signUp(app);
    const cards = await withCards(p);
    const [recycled, fused, upgraded, sold, traded, kept] = cards;
    const id = await create(p);
    const other = await create(p, "Autre");
    const all = cards.slice(0, 6).map((instanceId) => ({ instanceId }));
    await p.put(`/portfolios/${id}/cards`, { cards: all });
    await p.put(`/portfolios/${other}/cards`, { cards: all });

    expect((await p.post("/collection/recycle", { instanceIds: [recycled] })).status).toBe(200);
    const [row] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, fused!));
    const copy = await p.post("/test/grant-card", { cardId: row!.cardId, count: 1 });
    await ctx.db
      .update(schema.cardInstances)
      .set({ level: 2 })
      .where(eq(schema.cardInstances.id, copy.body.instanceIds[0]));
    expect((await p.post(`/collection/${copy.body.instanceIds[0]}/fuse`, { sourceId: fused })).status).toBe(200);
    await ctx.db.update(schema.cardInstances).set({ rarity: "C" }).where(eq(schema.cardInstances.id, upgraded!));
    expect((await p.post("/upgrade", { instanceIds: [upgraded] })).status).toBe(200);
    const listed = await p.post("/market", { instanceId: sold, startPrice: 5, buyout: 10, durationMs: 3_600_000 });
    expect((await buyer.post(`/market/${listed.body.id}/buy`)).status).toBe(200);
    const trade = await p.post("/trades", { to: buyer.username, give: [traded] });
    expect((await buyer.post(`/trades/${trade.body.id}/accept`)).status).toBe(200);

    for (const pid of [id, other]) {
      const left = (await p.get(`/portfolios/${pid}`)).body.cards.map((c: { instanceId: number }) => c.instanceId);
      expect(left).toEqual([kept]);
    }
    const [{ n }] = (await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from portfolio_cards where portfolio_id in (${id}, ${other})`,
    )) as unknown as [{ n: number }];
    expect(n).toBe(2);
  });

  it("affiche jusqu'à trois portfolios sur le profil, dans l'ordre choisi", async () => {
    const p = await signUp(app);
    const [card] = await withCards(p);
    const ids = [await create(p, "Un"), await create(p, "Deux"), await create(p, "Trois"), await create(p, "Quatre")];
    for (const id of ids) await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: card }] });
    expect((await p.put("/portfolios/profile", { ids })).status).toBe(400);
    expect((await p.put("/portfolios/profile", { ids: [ids[2], ids[0], ids[3]] })).status).toBe(200);
    const visitor = await signUp(app);
    const shown = (await visitor.get(`/players/${p.username}/portfolios`)).body;
    expect(shown.map((s: { name: string }) => s.name)).toEqual(["Trois", "Un", "Quatre"]);
    // Un portfolio vide n'est pas public.
    const empty = await create(p, "Vide");
    expect((await visitor.get(`/portfolios/${empty}`)).status).toBe(404);
    expect((await p.get(`/portfolios/${empty}`)).status).toBe(200);
  });

  it("compte un like par joueur, jamais sur les siens, et trie la page Communauté", async () => {
    const p = await signUp(app);
    const [card] = await withCards(p);
    const id = await create(p, "Aimé");
    await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: card }] });
    const fan = await signUp(app);
    const fan2 = await signUp(app);
    expect((await p.post(`/portfolios/${id}/like`)).status).toBe(403);
    expect((await fan.post(`/portfolios/${id}/like`)).body).toEqual({ likes: 1, liked: true });
    expect((await fan.post(`/portfolios/${id}/like`)).body.likes).toBe(1);
    expect((await fan2.post(`/portfolios/${id}/like`)).body.likes).toBe(2);
    expect((await fan2.del(`/portfolios/${id}/like`)).body).toEqual({ likes: 1, liked: false });
    const top = (await fan.get("/portfolios?sort=likes")).body.items;
    expect(top[0]).toMatchObject({ id, likes: 1, liked: true, mine: false });
    const recent = (await fan.get("/portfolios?sort=recent")).body.items;
    expect(recent.some((r: { id: number }) => r.id === id)).toBe(true);
  });

  it("vend les designs en PW, accorde ceux d'un succès, et refuse ceux qu'on n'a pas", async () => {
    const p = await signUp(app);
    const id = await create(p);
    expect((await p.patch(`/portfolios/${id}`, { background: "marbre" })).status).toBe(403);
    expect(
      (await p.patch(`/portfolios/${id}`, { background: "ardoise", frame: "pointilles", accent: "azur" })).status,
    ).toBe(200);
    await givePw(p, 1_000);
    const before = (await p.get("/me")).body.wallet.balance;
    expect((await p.post("/portfolios/designs/marbre/buy")).status).toBe(200);
    expect((await p.get("/me")).body.wallet.balance).toBe(before - PORTFOLIO_PRICES.background);
    expect((await p.post("/portfolios/designs/marbre/buy")).body.error).toBe("design_owned");
    expect((await p.post("/portfolios/designs/prisme/buy")).body.error).toBe("design_not_for_sale");
    expect((await p.patch(`/portfolios/${id}`, { background: "marbre" })).body.design.background).toBe("marbre");
    // Succès « Brillantes » palier I : le fond Prisme est à lui.
    await ctx.db.insert(schema.achievementsProgress).values({
      userId: p.userId,
      achievementKey: "shiny_1",
      progress: 1,
      unlockedAt: new Date(),
    });
    const catalog = (await p.get("/portfolios/designs")).body;
    expect(catalog.find((d: { key: string }) => d.key === "prisme").owned).toBe(true);
    expect(catalog.find((d: { key: string }) => d.key === "galaxie")).toMatchObject({ owned: false, price: 1_500 });
    expect(ECONOMY.startingBalance).toBeGreaterThan(0);
  });

  it("accepte une image de fond sur le modèle des bannières, supprimable depuis Admin", async () => {
    const p = await signUp(app);
    const admin = await signUpAdmin(app, ctx);
    const id = await create(p);
    expect(
      (await p.put(`/portfolios/${id}/background`, { image: Buffer.from("<svg/>").toString("base64") })).status,
    ).toBe(400);
    expect((await p.put(`/portfolios/${id}/background`, { image: PNG })).status).toBe(200);
    expect((await p.get(`/portfolios/${id}`)).body.design).toMatchObject({ background: "image" });
    const img = await app.inject({
      method: "GET",
      url: `/palacards/api/portfolios/${id}/background`,
      headers: { cookie: p.cookie },
    });
    expect(img.headers["content-type"]).toBe("image/png");
    const listed = (await admin.get("/admin/portfolio-backgrounds")).body;
    expect(listed.some((b: { portfolioId: number }) => b.portfolioId === id)).toBe(true);
    expect((await p.del(`/admin/portfolio-backgrounds/${id}`)).status).toBe(403);
    expect((await admin.del(`/admin/portfolio-backgrounds/${id}`)).status).toBe(200);
    expect((await p.get(`/portfolios/${id}`)).body.design.background).toBe("papier");
  });

  it("figure dans l'export RGPD", async () => {
    const p = await signUp(app);
    const [card] = await withCards(p);
    const id = await create(p);
    await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: card }] });
    const exported = (await p.get("/me/export")).body;
    expect(exported.portfolios[0]).toMatchObject({ id, name: "Mes favorites" });
    expect(exported.portfolioCards).toEqual([expect.objectContaining({ portfolioId: id, instanceId: card })]);
  });
});
