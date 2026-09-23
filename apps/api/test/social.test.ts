import { eq, schema, sql } from "@palacards/db";
import { GUILD_MAX_MEMBERS } from "@palacards/game";
import { afterAll, describe, expect, it } from "vitest";
import { checkObjective } from "../src/services/guilds.js";
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
    const del = await app.inject({ method: "DELETE", url: `/palacards/api/friends/${b.userId}`, headers: { cookie: a.cookie } });
    expect(del.statusCode).toBe(200);
    expect((await a.get("/friends")).body.friends).toHaveLength(0);
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
    const created = await chief.post("/guilds", { name: uniqueName("Guilde "), tag: uniqueName("G").slice(0, 5).replace(/[^A-Za-z0-9]/g, "X"), emblem: "🦉" });
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
    const { body } = await chief.post("/guilds", { name: uniqueName("Pleine "), tag: "PL" + String(Date.now()).slice(-3), emblem: "🗺️" });
    const joiners = await Promise.all(Array.from({ length: GUILD_MAX_MEMBERS }, () => signUp(app)));
    const results = await Promise.all(joiners.map((p) => p.post(`/guilds/${body.id}/join`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(GUILD_MAX_MEMBERS - 1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
  });

  it("récompense l'objectif hebdomadaire une seule fois", async () => {
    const chief = await signUp(app);
    const { body } = await chief.post("/guilds", { name: uniqueName("Objectif "), tag: "OB" + String(Date.now()).slice(-3), emblem: "🔭" });
    const detail = await chief.get("/guilds/mine");
    // Objectif forcé à une cible atteignable.
    await ctx.db.update(schema.guildObjectives).set({ kind: "open_packs", target: 1 }).where(eq(schema.guildObjectives.guildId, body.id));
    await chief.post("/packs/open");
    await Promise.all([checkObjective(ctx, body.id), checkObjective(ctx, body.id)]);
    const [p] = await ctx.db.select().from(schema.players).where(eq(schema.players.userId, chief.userId));
    expect(p!.bonusPacks).toBe(1);
    const [rows] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from ledger where user_id = ${chief.userId} and reason = 'guild_objective'`);
    expect(rows!.n).toBe(1);
    expect(detail.body.objective.target).toBeGreaterThan(0);
  });
});
