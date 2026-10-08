import { eq, schema, sql } from "@palacards/db";
import { GUILD_MAX_MEMBERS, GUILD_OBJECTIVE_REWARD, GUILD_OBJECTIVES } from "@palacards/game";
import { afterAll, describe, expect, it } from "vitest";
import { bumpObjective, checkObjective } from "../src/services/guilds.js";
import { progressionIdle } from "../src/services/progression.js";
import { makeApp, signUp, uniqueName } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

describe("amis", () => {
  it("demande, acceptation croisée et suppression", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    expect((await a.post("/friends", { username: b.username })).body.status).toBe("pending");
    expect((await a.post("/friends", { username: b.username })).status).toBe(409);
    const bList = await b.get("/friends");
    expect(bList.body.incoming.map((f: { id: string }) => f.id)).toEqual([a.userId]);
    // B « ajoute » A en retour : la demande est acceptée.
    expect((await b.post("/friends", { username: a.username })).body.status).toBe("accepted");
    expect((await a.get("/friends")).body.friends).toHaveLength(1);
    const notif = await a.get("/notifications");
    expect(notif.body.items[0].type).toBe("friend_accepted");
    const del = await app.inject({
      method: "DELETE",
      url: `/palacards/api/friends/${b.userId}`,
      headers: { cookie: a.cookie },
    });
    expect(del.statusCode).toBe(200);
    expect((await a.get("/friends")).body.friends).toHaveLength(0);
  });
});

describe("note de statut", () => {
  it("enregistrée filtrée, visible sur le profil, chez les amis et aux classements, effacée par son auteur", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    await a.post("/friends", { username: b.username });
    await b.post("/friends", { username: a.username });

    const set = await a.put("/me/status-note", { note: "  En chasse de  légendaires 🃏\n" });
    expect(set.status).toBe(200);
    expect(set.body.statusNote).toBe("En chasse de légendaires 🃏");
    expect((await b.get(`/players/${a.username}`)).body.statusNote).toBe("En chasse de légendaires 🃏");
    expect((await b.get("/friends")).body.friends[0].statusNote).toBe("En chasse de légendaires 🃏");

    // Classements : la note suit le joueur (tout en haut de « Richesse », base de test partagée).
    await ctx.db.execute(sql`update players set balance = 1999999998 where user_id = ${a.userId}`);
    const rows = (await b.get("/leaderboard?board=wealth&period=season")).body.rows as {
      username: string;
      statusNote?: string;
    }[];
    expect(rows.find((r) => r.username === a.username)?.statusNote).toBe("En chasse de légendaires 🃏");

    // Filtre : longueur, balises, liens ; la note précédente reste.
    expect((await a.put("/me/status-note", { note: "x".repeat(101) })).body.error).toBe("status_note_too_long");
    expect((await a.put("/me/status-note", { note: "<img src=x>" })).body.error).toBe("status_note_markup");
    expect((await a.put("/me/status-note", { note: "viens sur discord.gg/abc" })).body.error).toBe("status_note_link");
    expect((await a.get(`/players/${a.username}`)).body.statusNote).toBe("En chasse de légendaires 🃏");

    // L'auteur l'efface.
    expect((await a.put("/me/status-note", { note: "" })).body.statusNote).toBeNull();
    expect((await b.get(`/players/${a.username}`)).body.statusNote).toBeNull();
  });
});

describe("bannière du profil", () => {
  // Image de 40 × 30 px produite par Pillow (même que test/avatars.test.ts).
  const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAALklEQVR4nO3NMQEAMAgAoLk0ZjKxsazg5wMFiM56F/7JKhaLxWKxWCwWi8XilQH91QGGD5y0UgAAAABJRU5ErkJggg==";

  it("image importée, servie, visible sur le profil et aux classements, puis retirée", async () => {
    const a = await signUp(app);
    const b = await signUp(app);

    // Sans import : bannière par défaut.
    expect((await b.get(`/players/${a.username}`)).body.banner).toBeNull();

    const set = await a.put("/me/banner", { image: PNG });
    expect(set.status).toBe(200);
    expect(set.body.banner).toMatchObject({ userId: a.userId, version: expect.any(String) });
    expect((await b.get(`/players/${a.username}`)).body.banner).toEqual(set.body.banner);

    // Image servie aux joueurs connectés seulement, avec les mêmes protections que les avatars.
    const img = await app.inject({
      url: `/palacards/api/banners/${a.userId}?v=${set.body.banner.version}`,
      headers: { cookie: b.cookie },
    });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(img.rawPayload.equals(Buffer.from(PNG, "base64"))).toBe(true);
    expect((await app.inject({ url: `/palacards/api/banners/${a.userId}` })).statusCode).toBe(401);

    // Classements : l'image sert de fond à sa ligne (tout en haut de « Richesse », base de test partagée).
    await ctx.db.execute(sql`update players set balance = 1999999997 where user_id = ${a.userId}`);
    const rowOf = async () =>
      ((await b.get("/leaderboard?board=wealth&period=season")).body.rows as { id: string; banner?: unknown }[]).find(
        (r) => r.id === a.userId,
      );
    expect((await rowOf())?.banner).toEqual(set.body.banner);

    // Image déguisée refusée, la bannière reste.
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>".padEnd(64, " ")).toString("base64");
    expect((await a.put("/me/banner", { image: svg })).body.error).toBe("banner_format");
    expect((await b.get(`/players/${a.username}`)).body.banner).toEqual(set.body.banner);

    // Retour au défaut : plus d'image servie ni de fond au classement.
    const removed = await app.inject({
      method: "DELETE",
      url: "/palacards/api/me/banner",
      headers: { cookie: a.cookie, origin: "http://localhost:3000" },
    });
    expect(removed.json().banner).toBeNull();
    expect((await b.get(`/players/${a.username}`)).body.banner).toBeNull();
    expect((await rowOf())?.banner).toBeUndefined();
    expect(
      (await app.inject({ url: `/palacards/api/banners/${a.userId}`, headers: { cookie: b.cookie } })).statusCode,
    ).toBe(404);
  });
});

describe("suggestions de pseudos", () => {
  it("début du pseudo d'abord, amis ensuite, sans casse ni accents, jamais soi-même", async () => {
    const tag = `s${Date.now().toString(36).slice(-6)}`;
    const me = await signUp(app, `${tag}palme`);
    const other = await signUp(app, `${tag}pala`);
    const friend = await signUp(app, `${tag}palb`);
    const inside = await signUp(app, `x${tag}pal`);
    await signUp(app, `${tag}zzz`);
    await me.post("/friends", { username: friend.username });
    await friend.post("/friends", { username: me.username });

    const res = await me.get(`/players?q=${encodeURIComponent(`${tag.toUpperCase()}PÂL`)}`);
    expect(res.status).toBe(200);
    expect(res.body.map((p: { username: string }) => p.username)).toEqual([
      friend.username,
      other.username,
      inside.username,
    ]);
    expect(Object.keys(res.body[0]).sort()).toEqual(["avatar", "displayName", "friend", "username"]);
    expect(res.body[0].friend).toBe(true);

    // Page Amis : ni les amis ni les demandes en cours.
    await me.post("/friends", { username: other.username });
    const add = await me.get(`/players?q=${tag}pal&exclude=friends`);
    expect(add.body.map((p: { username: string }) => p.username)).toEqual([inside.username]);

    // `_` et `%` sont cherchés tels quels, pas comme jokers.
    expect((await me.get(`/players?q=${tag}_`)).body).toEqual([]);
    expect((await me.get("/players?q=")).status).toBe(400);
  });
});

describe("messages", () => {
  it("MP avec partage de carte et non-lus", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const card = (await a.post("/packs/open")).body.cards[0];
    const sent = await a.post("/messages", { to: b.username, body: "Regarde ça !", instanceId: card.instanceId });
    expect(sent.status).toBe(200);
    expect(sent.body.card).toMatchObject({ cardId: card.cardId, title: card.title });
    expect((await b.get("/me")).body.unreadMessages).toBe(1);
    const convs = await b.get("/messages");
    expect(convs.body[0]).toMatchObject({ kind: "dm", unread: 1 });
    const hist = await b.get(`/messages/history?channel=${encodeURIComponent(sent.body.channel)}`);
    expect(hist.body.items).toHaveLength(1);
    await b.post("/messages/read", { channel: sent.body.channel });
    expect((await b.get("/me")).body.unreadMessages).toBe(0);
    // Un tiers ne lit pas la conversation, ni ne partage une carte qui n'est pas à lui.
    const c = await signUp(app);
    expect((await c.get(`/messages/history?channel=${encodeURIComponent(sent.body.channel)}`)).status).toBe(403);
    expect((await c.post("/messages", { to: a.username, body: "", instanceId: card.instanceId })).status).toBe(404);
  });
});

describe("guildes", () => {
  it("création, adhésion, rôles et départ du chef", async () => {
    const chief = await signUp(app);
    const officer = await signUp(app);
    const member = await signUp(app);
    const created = await chief.post("/guilds", {
      name: uniqueName("Guilde "),
      tag: uniqueName("G")
        .slice(0, 5)
        .replace(/[^A-Za-z0-9]/g, "X"),
      emblem: "🦉",
    });
    expect(created.status).toBe(200);
    const id = created.body.id;
    await officer.post(`/guilds/${id}/join`);
    await member.post(`/guilds/${id}/join`);
    expect((await member.post("/guilds", { name: uniqueName("Autre "), tag: "AUTRE", emblem: "📚" })).status).toBe(409);
    expect((await chief.post(`/guilds/members/${officer.userId}/promote`)).status).toBe(200);
    expect((await officer.post(`/guilds/members/${chief.userId}/kick`)).status).toBe(403);
    // Le chef part : l'officier prend la tête.
    await chief.post("/guilds/leave");
    const mine = await officer.get("/guilds/mine");
    expect(mine.body.myRole).toBe("leader");
    expect(mine.body.members).toHaveLength(2);
    // Salon de guilde réservé aux membres.
    expect((await member.post("/messages", { channel: `guild:${id}`, body: "Salut la guilde" })).status).toBe(200);
    expect((await chief.get(`/messages/history?channel=guild:${id}`)).status).toBe(403);
  });

  it("limite la guilde à 20 membres", async () => {
    const chief = await signUp(app);
    const { body } = await chief.post("/guilds", {
      name: uniqueName("Pleine "),
      tag: "PL" + String(Date.now()).slice(-3),
      emblem: "🗺️",
    });
    const joiners = await Promise.all(Array.from({ length: GUILD_MAX_MEMBERS }, () => signUp(app)));
    const results = await Promise.all(joiners.map((p) => p.post(`/guilds/${body.id}/join`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(GUILD_MAX_MEMBERS - 1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
  });

  it("récompense l'objectif hebdomadaire une seule fois", async () => {
    const chief = await signUp(app);
    const { body } = await chief.post("/guilds", {
      name: uniqueName("Objectif "),
      tag: "OB" + String(Date.now()).slice(-3),
      emblem: "🔭",
    });
    const detail = await chief.get("/guilds/mine");
    // Objectif « ouvrir des paquets » à un paquet de la fin : le prochain tirage le termine.
    await ctx.db
      .update(schema.guildObjectives)
      .set({ kind: "open_packs", target: 60, progress: 59 })
      .where(eq(schema.guildObjectives.guildId, body.id));
    await chief.post("/packs/open");
    await Promise.all([checkObjective(ctx, body.id), checkObjective(ctx, body.id)]);
    // Recycler les cartes tirées ne fait pas reculer l'objectif.
    const [obj] = await ctx.db.select().from(schema.guildObjectives).where(eq(schema.guildObjectives.guildId, body.id));
    expect(obj!.progress).toBe(60);
    expect(obj!.completedAt).not.toBeNull();
    const [p] = await ctx.db.select().from(schema.players).where(eq(schema.players.userId, chief.userId));
    expect(p!.bonusPacks).toBe(GUILD_OBJECTIVE_REWARD.packs);
    // Un paquet bonus et des PW, une seule fois.
    const [rows] = await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from ledger where user_id = ${chief.userId} and reason = 'guild_objective'`,
    );
    expect(rows!.n).toBe(2);
    expect(detail.body.objective.target).toBeGreaterThan(0);
    expect(detail.body.objective.reward).toEqual(GUILD_OBJECTIVE_REWARD);
  });

  it("ne paie que les membres qui ont assez contribué, et rattrape ceux qui atteignent le minimum ensuite", async () => {
    const chief = await signUp(app);
    const late = await signUp(app);
    const { body } = await chief.post("/guilds", {
      name: uniqueName("Minimum "),
      tag: "MN" + String(Date.now()).slice(-3),
      emblem: "🧪",
    });
    expect((await late.post(`/guilds/${body.id}/join`)).status).toBe(200);
    await ctx.db
      .update(schema.guildObjectives)
      .set({ kind: "open_packs", target: 60, progress: 0 })
      .where(eq(schema.guildObjectives.guildId, body.id));
    await progressionIdle();
    const before = await ctx.db.select().from(schema.players).where(eq(schema.players.userId, chief.userId));
    const min = GUILD_OBJECTIVES.open_packs.minContribution;
    // Le chef fait tout l'objectif ; l'autre membre contribue sous le minimum.
    await bumpObjective(ctx, late.userId, { open_packs: min - 1 });
    await bumpObjective(ctx, chief.userId, { open_packs: 60 });
    await progressionIdle();
    const ledger = async (userId: string) =>
      (
        await ctx.db.execute<{ n: number }>(
          sql`select count(*)::int as n from ledger where user_id = ${userId} and reason = 'guild_objective'`,
        )
      )[0]!.n;
    expect(await ledger(chief.userId)).toBe(2);
    expect(await ledger(late.userId)).toBe(0);
    const [pw] = await ctx.db.execute<{ n: number }>(
      sql`select coalesce(sum(delta), 0)::int as n from ledger where user_id = ${chief.userId} and reason = 'guild_objective' and kind = 'pw'`,
    );
    expect(pw!.n).toBe(GUILD_OBJECTIVE_REWARD.pw);
    const [c] = await ctx.db.select().from(schema.players).where(eq(schema.players.userId, chief.userId));
    expect(c!.seasonXp - before[0]!.seasonXp).toBeGreaterThanOrEqual(GUILD_OBJECTIVE_REWARD.xp);
    const mine = await late.get("/guilds/mine");
    expect(mine.body.objective).toMatchObject({ completed: true, myContribution: min - 1, rewarded: false });
    // Il atteint le minimum après coup : payé une fois, pas deux.
    await bumpObjective(ctx, late.userId, { open_packs: 1 });
    await bumpObjective(ctx, late.userId, { open_packs: 1 });
    await progressionIdle();
    expect(await ledger(late.userId)).toBe(2);
    expect((await late.get("/guilds/mine")).body.objective.rewarded).toBe(true);
    const notif = await late.get("/notifications");
    expect(notif.body.items.map((n: { type: string }) => n.type)).toContain("guild_objective");
  });

  it("relit le ledger sous verrou : pas de double récompense si l'autre guilde du joueur valide en même temps", async () => {
    const chief = await signUp(app);
    const mover = await signUp(app);
    const { body } = await chief.post("/guilds", {
      name: uniqueName("Course "),
      tag: "CR" + String(Date.now()).slice(-3),
      emblem: "🏁",
    });
    expect((await mover.post(`/guilds/${body.id}/join`)).status).toBe(200);
    await chief.get("/guilds/mine");
    await ctx.db
      .update(schema.guildObjectives)
      .set({ kind: "open_packs", target: 1, progress: 1_000 })
      .where(eq(schema.guildObjectives.guildId, body.id));
    await progressionIdle();
    // Une autre transaction tient le joueur (comme la récompense de son autre guilde) : la vérification
    // doit l'attendre, puis voir la récompense déjà versée cette semaine.
    let check: Promise<void> | undefined;
    await ctx.db.transaction(async (tx) => {
      await tx.select().from(schema.players).where(eq(schema.players.userId, mover.userId)).for("update");
      check = checkObjective(ctx, body.id);
      for (let i = 0; i < 100; i++) {
        const [w] = await ctx.db.execute<{ n: number }>(sql`
          select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and query ilike '%"players"%for update%'
        `);
        if (w!.n > 0) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await tx.insert(schema.ledger).values({
        userId: mover.userId,
        kind: "bonus_pack",
        delta: 1,
        balanceAfter: 1,
        reason: "guild_objective",
        refId: "autre-guilde",
      });
    });
    await check;
    const [rows] = await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from ledger where user_id = ${mover.userId} and reason = 'guild_objective'`,
    );
    expect(rows!.n).toBe(1);
    const [p] = await ctx.db.select().from(schema.players).where(eq(schema.players.userId, mover.userId));
    expect(p!.bonusPacks).toBe(0);
    // Le chef, lui, est bien récompensé.
    const [c] = await ctx.db.select().from(schema.players).where(eq(schema.players.userId, chief.userId));
    expect(c!.bonusPacks).toBe(1);
  });
});
