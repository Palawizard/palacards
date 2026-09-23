import { eq, schema, sql } from "@palacards/db";
import { ECONOMY, MAX_STORED_PACKS } from "@palacards/game";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, signUp, uniqueName } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

describe("authentification", () => {
  it("inscrit un joueur avec pseudo + mot de passe et pose le cookie de session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/sign-up/email",
      headers: { origin: "http://localhost:3000" },
      payload: { username: uniqueName("Cookie"), password: "motdepasse123" },
    });
    expect(res.statusCode).toBe(200);
    const cookie = [res.headers["set-cookie"]].flat().find((c) => c?.startsWith("palawi_palacards_session="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/Path=\/palacards/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("refuse un pseudo invalide", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/sign-up/email",
      headers: { origin: "http://localhost:3000" },
      payload: { username: "a b", password: "motdepasse123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("protège les routes de jeu", async () => {
    const res = await app.inject({ method: "GET", url: "/palacards/api/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unauthorized");
  });

  it("crée la fiche joueur avec le solde de départ tracé dans le ledger", async () => {
    const p = await signUp(app);
    const me = await p.get("/me");
    expect(me.body.wallet).toEqual({ balance: ECONOMY.startingBalance, locked: 0, available: ECONOMY.startingBalance });
    expect(me.body.packs.available).toBe(MAX_STORED_PACKS);
    const rows = await ctx.db.select().from(schema.ledger).where(eq(schema.ledger.userId, p.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "pw", delta: ECONOMY.startingBalance, reason: "signup" });
  });

  it("donne le rôle admin aux pseudos de ADMIN_USERNAMES", async () => {
    const existing = await ctx.db.select().from(schema.user).where(eq(schema.user.username, "admin"));
    const admin = existing.length ? null : await signUp(app, "admin");
    if (admin) expect((await admin.get("/me")).body.isAdmin).toBe(true);
    const p = await signUp(app);
    expect((await p.get("/me")).body.isAdmin).toBe(false);
  });
});

describe("paquets", () => {
  it("ouvre un paquet de 5 cartes dont la dernière est au moins Rare", async () => {
    const p = await signUp(app);
    const res = await p.post("/packs/open");
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(5);
    expect(["R", "SR", "UR", "L"]).toContain(res.body.cards[4].rarity);
    expect(res.body.packs.available).toBe(MAX_STORED_PACKS - 1);
    const ledger = await ctx.db.select().from(schema.ledger).where(eq(schema.ledger.userId, p.userId));
    expect(ledger.map((l) => `${l.kind}:${l.delta}`).sort()).toEqual([
      "card:5",
      "pack:-1",
      `pw:${ECONOMY.startingBalance}`,
    ]);
  });

  it("refuse d'ouvrir sans paquet, puis utilise un paquet bonus hors plafond", async () => {
    const p = await signUp(app);
    await ctx.db
      .update(schema.players)
      .set({ packsStored: 0, packsUpdatedAt: new Date(), bonusPacks: 0 })
      .where(eq(schema.players.userId, p.userId));
    const refused = await p.post("/packs/open");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("no_packs");

    await ctx.db.update(schema.players).set({ bonusPacks: 1 }).where(eq(schema.players.userId, p.userId));
    const ok = await p.post("/packs/open");
    expect(ok.status).toBe(200);
    expect(ok.body.usedBonus).toBe(true);
    expect(ok.body.packs.bonus).toBe(0);
  });

  it("n'ouvre jamais plus de paquets que le stock sous requêtes concurrentes", async () => {
    const p = await signUp(app);
    const results = await Promise.all(Array.from({ length: MAX_STORED_PACKS + 3 }, () => p.post("/packs/open")));
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(MAX_STORED_PACKS);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const [row] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.cardInstances)
      .where(eq(schema.cardInstances.ownerId, p.userId));
    expect(row?.n).toBe(MAX_STORED_PACKS * 5);
  });

  it("déclenche la pity : UR ou mieux garantie après 50 paquets sans UR", async () => {
    const p = await signUp(app);
    await ctx.db.update(schema.players).set({ pityCounter: 50 }).where(eq(schema.players.userId, p.userId));
    const res = await p.post("/packs/open");
    expect(res.body.pityTriggered).toBe(true);
    expect(["UR", "L"]).toContain(res.body.cards[4].rarity);
    const [pl] = await ctx.db.select().from(schema.players).where(eq(schema.players.userId, p.userId));
    expect(pl?.pityCounter).toBe(0);
  });
});

describe("collection et recyclage", () => {
  let p: Awaited<ReturnType<typeof signUp>>;
  let cards: { instanceId: number; rarity: keyof typeof ECONOMY.recycleValue }[];

  beforeAll(async () => {
    p = await signUp(app);
    cards = (await p.post("/packs/open")).body.cards;
  });

  it("liste la collection avec la complétion par rareté", async () => {
    const list = await p.get("/collection?sort=rarity");
    expect(list.body.total).toBe(5);
    const summary = await p.get("/collection/summary");
    expect(summary.body.totalCards).toBe(5);
    expect(summary.body.byRarity.map((r: { rarity: string }) => r.rarity)).toEqual(["L", "UR", "SR", "R", "PC", "C"]);
  });

  it("recycle en PW avec une ligne de ledger", async () => {
    const [first] = cards;
    const res = await p.post("/collection/recycle", { instanceIds: [first!.instanceId] });
    expect(res.status).toBe(200);
    expect(res.body.gain).toBe(ECONOMY.recycleValue[first!.rarity]);
    expect(res.body.balance).toBe(ECONOMY.startingBalance + res.body.gain);
    const again = await p.post("/collection/recycle", { instanceIds: [first!.instanceId] });
    expect(again.status).toBe(404);
  });

  it("refuse de recycler une carte verrouillée ou d'un autre joueur", async () => {
    const [, second] = cards;
    await ctx.db
      .update(schema.cardInstances)
      .set({ lockedBy: "auction" })
      .where(eq(schema.cardInstances.id, second!.instanceId));
    expect((await p.post("/collection/recycle", { instanceIds: [second!.instanceId] })).status).toBe(409);
    const other = await signUp(app);
    expect((await other.post("/collection/recycle", { instanceIds: [cards[2]!.instanceId] })).status).toBe(404);
  });

  it("gère favoris et tags", async () => {
    const id = cards[3]!.instanceId;
    expect((await p.post(`/collection/${id}/favorite`, { favorite: true })).status).toBe(200);
    const tags = await p.put(`/collection/${id}/tags`, { tags: ["Histoire", "histoire", "top"] });
    expect(tags.body.tags).toEqual(["histoire", "top"]);
    const fav = await p.get("/collection?favorites=true");
    expect(fav.body.items.map((c: { instanceId: number }) => c.instanceId)).toEqual([id]);
    const tagged = await p.get("/collection?tag=top");
    expect(tagged.body.total).toBe(1);
    // Tous les tris répondent.
    for (const sort of ["date", "atk", "def", "views", "rarity", "title"]) {
      expect((await p.get(`/collection?sort=${sort}`)).status).toBe(200);
    }
  });
});

describe("catalogue", () => {
  it("cherche sans accents et pagine par curseur", async () => {
    const p = await signUp(app);
    const res = await p.get("/cards?q=synthetique%20n%C2%B0%2042&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.items[0].title).toBe("Carte synthétique n° 42");

    const page1 = await p.get("/cards?limit=10&sort=views");
    const page2 = await p.get(`/cards?limit=10&sort=views&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items).toHaveLength(10);
    const ids1 = new Set(page1.body.items.map((c: { cardId: number }) => c.cardId));
    expect(page2.body.items.some((c: { cardId: number }) => ids1.has(c.cardId))).toBe(false);
    expect(page1.body.items[9].views12m).toBeGreaterThanOrEqual(page2.body.items[0].views12m);
  });

  it("marque les cartes possédées et affiche la fiche", async () => {
    const p = await signUp(app);
    const opened = (await p.post("/packs/open")).body.cards;
    const owned = await p.get("/cards?owned=yes&limit=50");
    expect(owned.body.items.length).toBeGreaterThan(0);
    expect(owned.body.items.every((c: { owned: boolean }) => c.owned)).toBe(true);
    const sheet = await p.get(`/cards/${opened[0].cardId}`);
    expect(sheet.status).toBe(200);
    expect(sheet.body.mine.length).toBeGreaterThan(0);
    expect(sheet.body.owners.some((o: { userId: string }) => o.userId === p.userId)).toBe(true);
    expect((await p.get("/cards/999999999")).status).toBe(404);
  });
});
