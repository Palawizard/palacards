import { eq, schema, sql } from "@palacards/db";
import { ECONOMY, ELO_START } from "@palacards/game";
import { afterAll, describe, expect, it } from "vitest";
import { progressionIdle } from "../src/services/progression.js";
import { rolloverSeason } from "../src/services/seasons.js";
import { makeApp, signUp, uniqueName } from "./helpers.js";

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
    const rows = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from ledger where user_id = ${p.userId} and reason = 'achievement' and ref_id = 'first_pack'`);
    expect(rows[0]!.n).toBe(1);
    expect((await p.get("/notifications")).body.items.some((n: { type: string }) => n.type === "achievement")).toBe(true);
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
    expect((await p.post(`/collection/${opened.body.cards[1].instanceId}/fuse`, { sourceId: rest[3] })).body.error).toBe("different_cards");
    // Jamais le meilleur exemplaire (ici le niveau 5) dans un moins bon.
    expect((await p.post(`/collection/${rest[3]}/fuse`, { sourceId: target.instanceId })).body.error).toBe("source_better");
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
  it("change de pseudo, refuse un pseudo pris ou réservé", async () => {
    const p = await signUp(app);
    const other = await signUp(app);
    const name = uniqueName("Nouveau");
    expect((await p.post("/settings/username", { username: name })).body.displayName).toBe(name);
    expect((await p.post("/settings/username", { username: other.username })).body.error).toBe("username_taken");
    expect((await p.post("/settings/username", { username: "admin" })).body.error).toBe("username_reserved");
  });

  it("réserve l'admin aux pseudos configurés et trace les dons", async () => {
    const p = await signUp(app);
    expect((await p.get("/admin")).status).toBe(403);
    const existing = await ctx.db.select().from(schema.user).where(eq(schema.user.username, "admin"));
    if (!existing.length) await signUp(app, "admin");
    const adminLogin = await app.inject({
      method: "POST",
      url: "/palacards/api/auth/sign-in/username",
      headers: { origin: "http://localhost:3000" },
      payload: { username: "admin", password: "motdepasse123" },
    });
    const cookie = [adminLogin.headers["set-cookie"]].flat().filter(Boolean).map((c) => String(c).split(";")[0]).join("; ");
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
    // L'admin ne peut pas libérer son pseudo (il serait repris avec le rôle).
    const rename = await app.inject({
      method: "POST",
      url: "/palacards/api/settings/username",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: { username: uniqueName("ex") },
    });
    expect(rename.json().error).toBe("admin_username");
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
