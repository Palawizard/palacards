import { eq, schema } from "@palacards/db";
import { afterAll, describe, expect, it } from "vitest";
import { purgeExpired } from "../src/services/privacy.js";
import { makeApp, signUp, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

const deleteAccount = (c: Client, body: object) =>
  app.inject({
    method: "POST",
    url: "/palacards/api/auth/delete-user",
    headers: { cookie: c.cookie, origin: "http://localhost:3000" },
    payload: body,
  });

describe("export des données", () => {
  it("renvoie les données du joueur sans aucun secret", async () => {
    const p = await signUp(app);
    const res = await app.inject({ url: "/palacards/api/me/export", headers: { cookie: p.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="palacards-/);
    const data = JSON.parse(res.body);
    expect(data.account.id).toBe(p.userId);
    // Inscription sans email : l'adresse technique n'est pas une donnée du joueur.
    expect(data.account.email).toBe(null);
    expect(data.player.userId).toBe(p.userId);
    expect(data.ledger.length).toBeGreaterThan(0);
    expect(data.sessions).toHaveLength(1);
    expect(res.body).not.toMatch(/"(password|token|accessToken|refreshToken|idToken)"/);
    expect((await app.inject({ url: "/palacards/api/me/export" })).statusCode).toBe(401);
  });
});

describe("suppression du compte", () => {
  it("exige le bon mot de passe", async () => {
    const p = await signUp(app);
    expect((await deleteAccount(p, {})).statusCode).toBe(400);
    expect((await deleteAccount(p, { password: "mauvais-mot-de-passe" })).statusCode).toBe(400);
    expect((await p.get("/me")).status).toBe(200);
  });

  it("efface tout le compte et libère les PW bloqués des autres joueurs", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const trade = await a.post("/trades", { to: b.username, givePw: 10 });
    expect(trade.status).toBe(200);
    expect((await a.get("/me")).body.wallet.locked).toBe(10);

    const res = await deleteAccount(b, { password: "motdepasse123" });
    expect(res.statusCode).toBe(200);

    expect((await b.get("/me")).status).toBe(401);
    expect(await ctx.db.select().from(schema.user).where(eq(schema.user.id, b.userId))).toHaveLength(0);
    expect(await ctx.db.select().from(schema.players).where(eq(schema.players.userId, b.userId))).toHaveLength(0);
    expect(await ctx.db.select().from(schema.ledger).where(eq(schema.ledger.userId, b.userId))).toHaveLength(0);
    // L'échange est parti avec le compte, et les PW de l'offreur ne restent pas bloqués.
    expect((await a.get("/me")).body.wallet.locked).toBe(0);
  });
});

describe("vignettes Wikimedia relayées", () => {
  it("refuse sans session ou hors des hôtes Wikimedia", async () => {
    const p = await signUp(app);
    const u = encodeURIComponent("https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg");
    expect((await app.inject({ url: `/palacards/api/thumb?u=${u}` })).statusCode).toBe(401);
    for (const bad of [
      "https://evil.example/x.jpg",
      "http://upload.wikimedia.org/x.jpg",
      "https://upload.wikimedia.org.evil.example/x.jpg",
      "https://user@upload.wikimedia.org/x.jpg",
      "https://upload.wikimedia.org:8443/x.jpg",
      "/wikipedia/x.jpg",
    ]) {
      const r = await app.inject({
        url: `/palacards/api/thumb?u=${encodeURIComponent(bad)}`,
        headers: { cookie: p.cookie },
      });
      expect(r.statusCode, bad).toBe(400);
    }
  });
});

describe("purge des données expirées", () => {
  it("supprime les sessions expirées et les vieilles notifications", async () => {
    const p = await signUp(app);
    await ctx.db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.session.userId, p.userId));
    const [old] = await ctx.db
      .insert(schema.notifications)
      .values({ userId: p.userId, type: "test", createdAt: new Date(Date.now() - 200 * 86_400_000) })
      .returning({ id: schema.notifications.id });
    const purged = await purgeExpired(ctx);
    expect(purged.sessions).toBeGreaterThanOrEqual(1);
    expect(await ctx.db.select().from(schema.session).where(eq(schema.session.userId, p.userId))).toHaveLength(0);
    expect(await ctx.db.select().from(schema.notifications).where(eq(schema.notifications.id, old!.id))).toHaveLength(
      0,
    );
  });
});
