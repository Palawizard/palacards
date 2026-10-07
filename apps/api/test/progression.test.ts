import { eq, schema, sql } from "@palacards/db";
import { ECONOMY, ELO_START, LUCK_MIN_PACKS, TITLE_BOARDS } from "@palacards/game";
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
    for (const board of TITLE_BOARDS) {
      for (const period of ["season", "all"]) {
        const res = await p.get(`/leaderboard?board=${board}&period=${period}`);
        expect(res.status).toBe(200);
      }
    }
    await p.patch("/me/settings", { avatar: "🦉" });
    const res = await p.get("/leaderboard?board=collection&period=season");
    expect(res.body.rows.find((r: { me: boolean }) => r.me)?.avatar).toBe("🦉");
  });

  it("classe par légendaires différents, doublons comptés une fois, premier arrivé devant", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const c = await signUp(app);
    const season = (await a.get("/me")).body.season as number;
    const cards = await ctx.db.execute<{ id: number }>(
      sql`select id::int as id from cards where season = ${season} order by id limit 3`,
    );
    const ids = cards.map((x) => x.id);
    // Cartes données puis passées en légendaires (date d'obtention fixée pour le départage).
    const give = async (p: typeof a, cardId: number, count: number, at: string) => {
      const { instanceIds } = (await p.post("/test/grant-card", { cardId, count })).body as { instanceIds: number[] };
      await ctx.db.execute(sql`
        update card_instances set rarity = 'L', obtained_at = ${at}::timestamptz
        where id in (${sql.join(
          instanceIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      `);
    };
    // A : 2 légendaires différentes (dont un doublon), atteintes en 2001 ; B : 2 aussi, atteintes en 2000 ; C : aucune.
    await give(a, ids[0]!, 3, "2001-01-01");
    await give(a, ids[1]!, 1, "2001-01-02");
    await give(b, ids[0]!, 1, "2000-01-01");
    await give(b, ids[2]!, 1, "2000-01-02");
    const [common] = await ctx.db.execute<{ id: number }>(
      sql`select id::int as id from cards where season = ${season} and rarity <> 'L' limit 1`,
    );
    await c.post("/test/grant-card", { cardId: common!.id, count: 1 });

    const rows = (await a.get("/leaderboard?board=legendary&period=season")).body.rows as {
      id: string;
      value: number;
      rank: number;
    }[];
    const ra = rows.find((r) => r.id === a.userId)!;
    const rb = rows.find((r) => r.id === b.userId)!;
    expect(ra.value).toBe(2);
    expect(rb.value).toBe(2);
    expect(rb.rank).toBeLessThan(ra.rank);
    expect(rows.find((r) => r.id === c.userId)).toBeUndefined();
    // Ordre décroissant.
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.value).toBeLessThanOrEqual(rows[i - 1]!.value);
  });

  it("affiche le badge « Créateur » à côté des comptes admin", async () => {
    const admin = await signUpAdmin(app, ctx);
    const p = await signUp(app);
    // Tout en haut du classement « Richesse » pour être sûr d'y figurer (base de test partagée).
    await ctx.db.execute(sql`update players set balance = 2000000000 where user_id = ${admin.userId}`);
    await ctx.db.execute(sql`update players set balance = 1999999999 where user_id = ${p.userId}`);
    const rows = (await p.get("/leaderboard?board=wealth&period=season")).body.rows as {
      username: string;
      creator?: boolean;
    }[];
    expect(rows.find((r) => r.username === admin.username)?.creator).toBe(true);
    expect(rows.find((r) => r.username === p.username)?.creator).toBeUndefined();
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

  it("compte les boosters ouverts et classe la chance à partir du minimum de boosters", async () => {
    const p = await signUp(app);
    const mine = async (board: string) =>
      (await p.get(`/leaderboard?board=${board}&period=season`)).body.rows.find((r: { me: boolean }) => r.me);
    for (let i = 0; i < LUCK_MIN_PACKS - 1; i++) expect((await p.post("/packs/open")).status).toBe(200);
    expect((await mine("packs")).value).toBe(LUCK_MIN_PACKS - 1);
    // Sous le minimum : absent du classement « Chance ».
    expect(await mine("luck")).toBeUndefined();
    await p.post("/packs/open");
    const [stats] = await ctx.db.execute<{ pulled: number; expected: number }>(
      sql`select pulled_points::float8 as pulled, expected_points::float8 as expected from pack_stats where user_id = ${p.userId}`,
    );
    const luck = await mine("luck");
    expect(luck.packs).toBe(LUCK_MIN_PACKS);
    expect(luck.value).toBe(Math.round((stats!.pulled * 100) / stats!.expected));
    expect(
      (await p.get("/leaderboard?board=packs&period=all")).body.rows.find((r: { me: boolean }) => r.me).value,
    ).toBe(LUCK_MIN_PACKS);
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

  it("titres de fin de saison : attribués aux premiers, affichés, au choix du joueur", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    await ctx.db.update(schema.players).set({ elo: 9_000, eloPeak: 9_000 }).where(eq(schema.players.userId, a.userId));
    await ctx.db.update(schema.players).set({ balance: 9e12 }).where(eq(schema.players.userId, b.userId));
    const season = (await a.get("/me")).body.season;
    const res = await rolloverSeason(ctx);
    expect(res?.titles).toBeGreaterThanOrEqual(2);

    // Premier titre : affiché d'office sur le profil, avec une notification.
    const profile = (await b.get(`/players/${a.username}`)).body;
    expect(profile.title).toEqual({ board: "elo", rank: 1, season });
    expect(profile.titles).toContainEqual({ board: "elo", rank: 1, season });
    const notes = (await a.get("/notifications")).body.items;
    expect(notes.some((n: { type: string }) => n.type === "title_won")).toBe(true);
    // Le titre suit le joueur dans les classements.
    const row = (await a.get("/leaderboard?board=elo&period=all")).body.rows.find((r: { me: boolean }) => r.me);
    expect(row.title).toEqual({ board: "elo", rank: 1, season });

    // Choix du titre : seulement parmi les siens, ou aucun.
    expect((await b.put("/settings/title", { title: { season, board: "elo" } })).status).toBe(404);
    expect((await b.put("/settings/title", { title: null })).body.title).toBeNull();
    expect((await b.get(`/players/${b.username}`)).body.title).toBeNull();
    const chosen = await b.put("/settings/title", { title: { season, board: "wealth" } });
    expect(chosen.body.title).toEqual({ board: "wealth", rank: 1, season });
    expect((await b.put("/settings/title", { title: { season, board: "nope" } })).status).toBe(400);
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
