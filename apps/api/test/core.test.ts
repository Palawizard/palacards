import { eq, schema, sql } from "@palacards/db";
import { CARDS_PER_PACK, ECONOMY, MAX_STORED_PACKS } from "@palacards/game";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { FastifyRequest } from "fastify";
import { rateLimitKey } from "../src/app.js";
import { adminCommand } from "../src/services/roles.js";
import { achievementPw, makeApp, signUp, uniqueName } from "./helpers.js";

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

  it("le rôle admin vient de la base, jamais du pseudo ni du corps de l'inscription", async () => {
    // Pseudos « admin » / « palawi » : de simples pseudos, sans aucun droit.
    for (const name of ["admin", "palawi"]) {
      const existing = await ctx.db.select().from(schema.user).where(eq(schema.user.username, name));
      const p = existing.length ? null : await signUp(app, name);
      if (p) {
        expect((await p.get("/me")).body.isAdmin).toBe(false);
        expect((await p.get("/admin")).status).toBe(403);
      }
    }
    // `isAdmin` envoyé à l'inscription est ignoré (champ `input: false`).
    const name = uniqueName("Sneaky");
    const res = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/sign-up/email",
      headers: { origin: "http://localhost:3000" },
      payload: { username: name, password: "motdepasse123", isAdmin: true },
    });
    const [row] = await ctx.db.select().from(schema.user).where(eq(schema.user.username, name.toLowerCase()));
    if (res.statusCode === 200) expect(row?.isAdmin).toBe(false);
    else expect(row).toBeUndefined();
    // La mise à jour du profil par Better Auth reste coupée.
    const p = await signUp(app);
    const update = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/update-user",
      headers: { cookie: p.cookie, origin: "http://localhost:3000" },
      payload: { isAdmin: true },
    });
    expect(update.statusCode).toBeGreaterThanOrEqual(400);
    expect((await p.get("/me")).body.isAdmin).toBe(false);
  });

  it("CLI admin : grant / list / revoke, effet immédiat sur la session", async () => {
    const p = await signUp(app);
    expect((await p.get("/admin")).status).toBe(403);
    expect(await adminCommand(ctx.db, ["grant", p.username.toUpperCase()])).toMatchObject({ code: 0 });
    expect((await p.get("/me")).body.isAdmin).toBe(true);
    expect((await p.get("/admin")).status).toBe(200);
    expect((await adminCommand(ctx.db, ["list"])).message).toContain(p.username.toLowerCase());
    // Renommer ne fait pas perdre le rôle (il est attaché au compte) et ne le transmet à personne.
    const renamed = uniqueName("Chef");
    expect((await p.post("/settings/username", { username: renamed })).status).toBe(200);
    expect((await p.get("/me")).body.isAdmin).toBe(true);
    expect((await signUp(app, p.username).then((q) => q.get("/me"))).body.isAdmin).toBe(false);
    expect(await adminCommand(ctx.db, ["revoke", renamed])).toMatchObject({ code: 0 });
    expect((await p.get("/me")).body.isAdmin).toBe(false);
    expect((await p.get("/admin")).status).toBe(403);
    expect(await adminCommand(ctx.db, ["grant", "personne-inconnue"])).toMatchObject({ code: 1 });
    expect(await adminCommand(ctx.db, ["grant"])).toMatchObject({ code: 2 });
    expect(await adminCommand(ctx.db, ["oups", "x"])).toMatchObject({ code: 2 });
  });
});

describe("configuration", () => {
  it("refuse le secret d'exemple, le mode test et une URL en http en production", () => {
    const base = {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "x".repeat(40),
      BETTER_AUTH_URL: "https://www.palawi.fr",
    };
    expect(() => loadConfig(base)).not.toThrow();
    expect(() => loadConfig({ ...base, BETTER_AUTH_SECRET: "change-me-change-me-change-me-change-me" })).toThrow();
    expect(() => loadConfig({ ...base, GAME_TEST_MODE: "1" })).toThrow();
    expect(() => loadConfig({ ...base, BETTER_AUTH_URL: "http://www.palawi.fr" })).toThrow(/https/);
    expect(() => loadConfig({ NODE_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(40) })).toThrow(/BETTER_AUTH_URL/);
    // En dev, http reste accepté.
    expect(() => loadConfig({ BETTER_AUTH_URL: "http://localhost:4000" })).not.toThrow();
  });
});

describe("limitation de débit", () => {
  const fakeReq = (headers: Record<string, string>, ip = "10.0.0.1") =>
    ({ headers, ip, raw: {} }) as unknown as FastifyRequest;

  it("compte par joueur (session validée), sinon par IP ; un cookie inventé ne crée pas de compteur", async () => {
    const p = await signUp(app);
    const config = { TRUST_PROXY: false };
    expect(await rateLimitKey(config, ctx.auth, fakeReq({ cookie: p.cookie }))).toBe(`user:${p.userId}`);
    // Deux sessions du même joueur : un seul compteur.
    const again = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/sign-in/username",
      headers: { origin: "http://localhost:3000" },
      payload: { username: p.username, password: "motdepasse123" },
    });
    const cookie2 = [again.headers["set-cookie"]]
      .flat()
      .filter(Boolean)
      .map((c) => String(c).split(";")[0])
      .join("; ");
    expect(cookie2).not.toBe(p.cookie);
    expect(await rateLimitKey(config, ctx.auth, fakeReq({ cookie: cookie2 }))).toBe(`user:${p.userId}`);
    // Cookie inventé : retombe sur l'IP.
    expect(await rateLimitKey(config, ctx.auth, fakeReq({ cookie: "palawi_palacards_session=nimportequoi" }))).toBe(
      "ip:10.0.0.1",
    );
    expect(await rateLimitKey(config, ctx.auth, fakeReq({}))).toBe("ip:10.0.0.1");
  });

  it("ne lit cf-connecting-ip que derrière le proxy", async () => {
    const headers = { "cf-connecting-ip": "203.0.113.7" };
    expect(await rateLimitKey({ TRUST_PROXY: false }, ctx.auth, fakeReq(headers))).toBe("ip:10.0.0.1");
    expect(await rateLimitKey({ TRUST_PROXY: true }, ctx.auth, fakeReq(headers))).toBe("ip:203.0.113.7");
    expect(await rateLimitKey({ TRUST_PROXY: true }, ctx.auth, fakeReq({}))).toBe("ip:10.0.0.1");
  });
});

describe("sessions", () => {
  it("coupe les sockets du joueur quand ses sessions sont révoquées", async () => {
    const p = await signUp(app);
    const spy = vi.spyOn(ctx.rt, "disconnectUser");
    const res = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/change-password",
      headers: { cookie: p.cookie, origin: "http://localhost:3000" },
      payload: { currentPassword: "motdepasse123", newPassword: "nouveaumotdepasse", revokeOtherSessions: true },
    });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith(p.userId);
    const out = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/sign-out",
      headers: { cookie: p.cookie, origin: "http://localhost:3000" },
    });
    expect(out.statusCode).toBe(200);
    spy.mockRestore();
  });
});

describe("paquets", () => {
  it("ouvre un paquet de 10 cartes dont la dernière est au moins Rare", async () => {
    const p = await signUp(app);
    const res = await p.post("/packs/open");
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(CARDS_PER_PACK);
    expect(["R", "SR", "UR", "L"]).toContain(res.body.cards.at(-1).rarity);
    expect(res.body.packs.available).toBe(MAX_STORED_PACKS - 1);
    const ledger = await ctx.db.select().from(schema.ledger).where(eq(schema.ledger.userId, p.userId));
    // Les succès (premier paquet…) sont crédités en arrière-plan : hors du périmètre de ce test.
    const own = ledger.filter((l) => l.reason !== "achievement");
    expect(own.map((l) => `${l.kind}:${l.delta}`).sort()).toEqual([
      `card:${CARDS_PER_PACK}`,
      "pack:-1",
      `pw:${ECONOMY.startingBalance}`,
    ]);
  });

  it("répond avec les cartes même si un effet après commit échoue (paquet déjà consommé)", async () => {
    const p = await signUp(app);
    const toUser = vi.spyOn(ctx.rt, "toUser").mockImplementation(() => {
      throw new Error("socket en panne");
    });
    const load = vi.spyOn(ctx.wiki, "load").mockImplementation(() => {
      throw new Error("Wikimedia en panne");
    });
    try {
      const res = await p.post("/packs/open");
      expect(res.status).toBe(200);
      expect(res.body.cards).toHaveLength(CARDS_PER_PACK);
      expect(res.body.cards.every((c: { instanceId: number; title: string }) => c.instanceId > 0 && c.title)).toBe(
        true,
      );
      // Ses propres cartes gardent leurs vues.
      expect(res.body.cards[0]).toHaveProperty("views12m");
      expect(res.body.packs.available).toBe(MAX_STORED_PACKS - 1);
    } finally {
      toUser.mockRestore();
      load.mockRestore();
    }
    const owned = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.ownerId, p.userId));
    expect(owned).toHaveLength(CARDS_PER_PACK);
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
    expect(row?.n).toBe(MAX_STORED_PACKS * CARDS_PER_PACK);
  });

  it("déclenche la pity : UR ou mieux garantie après 50 paquets sans UR", async () => {
    const p = await signUp(app);
    await ctx.db.update(schema.players).set({ pityCounter: 50 }).where(eq(schema.players.userId, p.userId));
    const res = await p.post("/packs/open");
    expect(res.body.pityTriggered).toBe(true);
    expect(["UR", "L"]).toContain(res.body.cards.at(-1).rarity);
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
    expect(list.body.total).toBe(CARDS_PER_PACK);
    const summary = await p.get("/collection/summary");
    expect(summary.body.totalCards).toBe(CARDS_PER_PACK);
    expect(summary.body.byRarity.map((r: { rarity: string }) => r.rarity)).toEqual(["L", "UR", "SR", "R", "PC", "C"]);
  });

  it("recycle en PW avec une ligne de ledger", async () => {
    const [first] = cards;
    const res = await p.post("/collection/recycle", { instanceIds: [first!.instanceId] });
    expect(res.status).toBe(200);
    expect(res.body.gain).toBe(ECONOMY.recycleValue[first!.rarity]);
    expect(res.body.balance).toBe(ECONOMY.startingBalance + res.body.gain + (await achievementPw(ctx, p.userId)));
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
    expect(res.body.approximate).toBe(false);
    // Faute de frappe : aucun titre exact, repli sur les titres approchants.
    const typo = await p.get("/cards?q=carte%20synthetiqe&limit=5");
    expect(typo.body.approximate).toBe(true);
    expect(typo.body.items.length).toBeGreaterThan(0);
    // Les jokers LIKE saisis par le joueur sont pris au pied de la lettre.
    expect(
      (await p.get("/cards?q=%25%25%25&limit=5")).body.items.filter((c: { title: string }) => !c.title.includes("%")),
    ).toHaveLength(0);

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
