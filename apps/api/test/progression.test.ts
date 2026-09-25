import { eq, schema, sql } from "@palacards/db";
import { ECONOMY, ELO_START } from "@palacards/game";
import { afterAll, describe, expect, it } from "vitest";
import { lockOrder, PLAYER_LOCK_ORDER } from "../src/services/players.js";
import { collectionEvent, progressionIdle } from "../src/services/progression.js";
import { rolloverSeason } from "../src/services/seasons.js";
import { makeApp, signUp, signUpAdmin, uniqueName } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

describe("succès", () => {
  it("débloque « Premier paquet » une seule fois avec sa récompense", async () => {
    const p = await signUp(app);
    await p.post("/packs/open");
    await p.post("/packs/open");
    // Les succès sont traités après la réponse : on attend que la file se vide.
    await progressionIdle();
    const list = await p.get("/achievements");
    const first = list.body.find((a: { key: string }) => a.key === "first_pack");
    expect(first.unlockedAt).not.toBeNull();
    const rows = await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from ledger where user_id = ${p.userId} and reason = 'achievement' and ref_id = 'first_pack'`,
    );
    expect(rows[0]!.n).toBe(1);
    expect((await p.get("/notifications")).body.items.some((n: { type: string }) => n.type === "achievement")).toBe(
      true,
    );
  });
});

describe("succès de collection", () => {
  it("ne compte que les cartes tirées soi-même, pas celles reçues par échange ou données", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const pulledA = (await a.post("/packs/open")).body.cards as { cardId: number; instanceId: number }[];
    const pulledB = (await b.post("/packs/open")).body.cards as { cardId: number; instanceId: number }[];
    const mineA = new Set(pulledA.map((c) => c.cardId));
    const before = await collectionEvent(ctx.db, a.userId);
    expect(before).toMatchObject({ type: "collection", uniqueCards: mineA.size });

    // B donne gratuitement à A une carte que A n'a pas tirée : elle ne compte ni pour A ni pour B.
    const gift = pulledB.find(
      (c) => !mineA.has(c.cardId) && pulledB.filter((x) => x.cardId === c.cardId).length === 1,
    )!;
    const beforeB = await collectionEvent(ctx.db, b.userId);
    const trade = await b.post("/trades", { to: a.username, give: [gift.instanceId] });
    expect((await a.post(`/trades/${trade.body.id}/accept`)).status).toBe(200);
    // Carte donnée par l'admin (route de test) : ne compte pas non plus.
    const [fresh] = await ctx.db.execute<{ id: number }>(sql`
      select c.id::int as id from cards c
      where c.season = (select id from seasons where status = 'active')
        and not exists (select 1 from card_instances i where i.owner_id = ${a.userId} and i.card_id = c.id)
      limit 1
    `);
    expect((await a.post("/test/grant-card", { cardId: fresh!.id, count: 2 })).status).toBe(200);
    await progressionIdle();
    expect(await collectionEvent(ctx.db, a.userId)).toEqual(before);
    expect(await collectionEvent(ctx.db, b.userId)).toMatchObject({
      uniqueCards: (beforeB as { uniqueCards: number }).uniqueCards - 1,
    });
    const list = (await a.get("/achievements")).body as { key: string; progress: number }[];
    expect(list.find((x) => x.key === "collection_1000")!.progress).toBe(mineA.size);
  });
});

describe("fusion et niveaux", () => {
  it("fusionne un doublon (+1 niveau, +4 % de stats) jusqu'au niveau 5", async () => {
    const p = await signUp(app);
    const opened = await p.post("/packs/open");
    const target = opened.body.cards[0];
    const copies = await p.post("/test/grant-card", { cardId: target.cardId, count: 5 });
    const [first, ...rest] = copies.body.instanceIds as number[];
    const fused = await p.post(`/collection/${target.instanceId}/fuse`, { sourceId: first });
    expect(fused.status).toBe(200);
    expect(fused.body.level).toBe(2);
    expect(fused.body.atk).toBe(Math.round(target.atk * 1.04));
    for (const id of rest.slice(0, 3)) await p.post(`/collection/${target.instanceId}/fuse`, { sourceId: id });
    const max = await p.post(`/collection/${target.instanceId}/fuse`, { sourceId: rest[3] });
    expect(max.body.error).toBe("max_level");
    // Pas de fusion d'articles différents ni avec soi-même.
    expect((await p.post(`/collection/${target.instanceId}/fuse`, { sourceId: target.instanceId })).status).toBe(400);
    expect(
      (await p.post(`/collection/${opened.body.cards[1].instanceId}/fuse`, { sourceId: rest[3] })).body.error,
    ).toBe("different_cards");
    // Jamais le meilleur exemplaire (ici le niveau 5) dans un moins bon.
    expect((await p.post(`/collection/${rest[3]}/fuse`, { sourceId: target.instanceId })).body.error).toBe(
      "source_better",
    );
  });
});

describe("classements et saisons", () => {
  it("classe par collection, Elo et richesse", async () => {
    const p = await signUp(app);
    await p.post("/packs/open");
    for (const board of ["collection", "elo", "wealth", "guilds"]) {
      for (const period of ["season", "all"]) {
        const res = await p.get(`/leaderboard?board=${board}&period=${period}`);
        expect(res.status).toBe(200);
      }
    }
    const res = await p.get("/leaderboard?board=collection&period=season");
    expect(res.body.rows.some((r: { me: boolean }) => r.me)).toBe(true);
  });

  it("verrouille les joueurs dans le même ordre en SQL (bascule) et en JS (lockPlayers)", async () => {
    // Ids Better Auth à casse mixte : la collation en_US classerait « abc » avant « ABD » et « Zed »,
    // l'ordre JS (unités de code) fait l'inverse. Les deux côtés doivent suivre la collation "C".
    const ids = ["abc", "ABD", "Zed", "aZ", "zz", "A0", "9x", "_u", "Ab", "aB", "b", "B"];
    const values = sql.join(
      ids.map((id) => sql`(${id})`),
      sql`, `,
    );
    const rows = await ctx.db.execute<{ user_id: string }>(
      sql`select user_id from (values ${values}) as t(user_id) order by ${PLAYER_LOCK_ORDER}`,
    );
    expect(rows.map((r) => r.user_id)).toEqual(lockOrder(ids));
    // Et avec de vrais joueurs inscrits (ids générés par Better Auth).
    const players = await Promise.all([signUp(app), signUp(app), signUp(app), signUp(app)]);
    const real = players.map((p) => p.userId);
    const inList = sql.join(
      real.map((id) => sql`${id}`),
      sql`, `,
    );
    const locked = await ctx.db.execute<{ user_id: string }>(
      sql`select user_id from players where user_id in (${inList}) order by ${PLAYER_LOCK_ORDER}`,
    );
    expect(locked.map((r) => r.user_id)).toEqual(lockOrder(real));
  });

  it("bascule de saison : archives, Elo remis à zéro, nouvelle édition", async () => {
    const p = await signUp(app);
    await p.post("/packs/open");
    await ctx.db.update(schema.players).set({ elo: 1234, eloPeak: 1234 }).where(eq(schema.players.userId, p.userId));
    const before = (await p.get("/me")).body.season;
    const res = await rolloverSeason(ctx);
    expect(res).toMatchObject({ from: before, to: before + 1 });
    const me = await p.get("/me");
    expect(me.body.season).toBe(before + 1);
    expect(me.body.elo).toBe(ELO_START);
    const [archived] = await ctx.db
      .select()
      .from(schema.seasonArchives)
      .where(eq(schema.seasonArchives.userId, p.userId));
    expect(archived).toMatchObject({ season: before, elo: 1234 });
    // Les nouveaux tirages portent l'édition de la nouvelle saison.
    const opened = await p.post("/packs/open");
    expect(opened.body.cards[0].season).toBe(before + 1);
    // Le meilleur Elo historique reste au classement « tout temps ».
    const all = await p.get("/leaderboard?board=elo&period=all");
    expect(all.body.rows.find((r: { me: boolean }) => r.me).value).toBe(1234);
  });
});

describe("paramètres et admin", () => {
  it("change de pseudo, refuse un pseudo pris", async () => {
    const p = await signUp(app);
    const other = await signUp(app);
    const name = uniqueName("Nouveau");
    expect((await p.post("/settings/username", { username: name })).body.displayName).toBe(name);
    expect((await p.post("/settings/username", { username: other.username })).body.error).toBe("username_taken");
    // Plus de pseudo « admin » réservé : le rôle ne dépend pas du pseudo.
    const free = uniqueName("admin");
    expect((await p.post("/settings/username", { username: free })).status).toBe(200);
    expect((await p.get("/me")).body.isAdmin).toBe(false);
  });

  it("réserve l'admin aux comptes admin (en base) et trace les dons", async () => {
    const p = await signUp(app);
    expect((await p.get("/admin")).status).toBe(403);
    const { cookie } = await signUpAdmin(app, ctx);
    const grant = await app.inject({
      method: "POST",
      url: "/palacards/api/admin/grant",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: { username: p.username, pw: 500, packs: 2, note: "test" },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json()).toEqual({ balance: ECONOMY.startingBalance + 500, bonusPacks: 2 });
    const overview = await app.inject({ method: "GET", url: "/palacards/api/admin", headers: { cookie } });
    expect(overview.json().economy.supply.total).toBeGreaterThan(0);
    // L'admin peut changer de pseudo : le rôle suit le compte, l'ancien pseudo repris n'a aucun droit.
    const rename = await app.inject({
      method: "POST",
      url: "/palacards/api/settings/username",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: { username: uniqueName("ex") },
    });
    expect(rename.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/palacards/api/admin", headers: { cookie } })).statusCode).toBe(
      200,
    );
    // Bascule forcée : une requête rejouée avec une saison déjà terminée est refusée.
    const season = (await p.get("/me")).body.season as number;
    const stale = await app.inject({
      method: "POST",
      url: "/palacards/api/admin/season",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: { from: season - 1 },
    });
    expect(stale.json().error).toBe("season_changed");
  });

  it("impose le pseudo comme nom affiché à l'inscription", async () => {
    const username = uniqueName("vrai");
    const res = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/sign-up/email",
      headers: { origin: "http://localhost:3000" },
      payload: { username, password: "motdepasse123", displayUsername: "Palawi", image: "https://evil.example/x.png" },
    });
    expect(res.statusCode).toBe(200);
    const [u] = await ctx.db.select().from(schema.user).where(eq(schema.user.username, username.toLowerCase()));
    expect(u!.displayUsername).toBe(username);
    expect(u!.image).toBeNull();
  });

  it("ferme les routes Better Auth qui contourneraient nos contrôles et limite les avatars", async () => {
    const p = await signUp(app);
    const res = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/update-user",
      headers: { cookie: p.cookie, origin: "http://localhost:3000" },
      payload: { username: "admin", displayUsername: "Admin" },
    });
    expect(res.statusCode).toBe(404);
    const call = (avatar: unknown) =>
      app.inject({
        method: "PATCH",
        url: "/palacards/api/me/settings",
        headers: { cookie: p.cookie, origin: "http://localhost:3000" },
        payload: { avatar },
      });
    expect((await call("ADMN")).statusCode).toBe(400);
    expect((await call("🦉")).json().avatar).toBe("🦉");
  });
});
