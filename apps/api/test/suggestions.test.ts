import { eq, schema } from "@palacards/db";
import { afterAll, describe, expect, it } from "vitest";
import { makeApp, signUp, signUpAdmin } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

/** Compte vieux de deux jours : le bandeau n'apparaît pas le premier jour. */
async function ageAccount(userId: string) {
  await ctx.db
    .update(schema.players)
    .set({ createdAt: new Date(Date.now() - 2 * 86_400_000) })
    .where(eq(schema.players.userId, userId));
}

describe("suggestions", () => {
  it("le joueur envoie une suggestion et la retrouve ; l'admin la voit, répond, et l'auteur est prévenu", async () => {
    const p = await signUp(app);
    const admin = await signUpAdmin(app, ctx);
    const before = (await admin.get("/me")).body.newSuggestions;

    const sent = await p.post("/suggestions", {
      kind: "content",
      title: "Un booster Jeux vidéo",
      body: "Un booster à thème avec les jeux vidéo cultes, Zelda, Mario, etc.",
    });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ kind: "content", status: "new", reply: null });
    expect((await p.get("/suggestions")).body.map((x: { id: number }) => x.id)).toEqual([sent.body.id]);

    // Pastille de l'admin, rien pour un joueur.
    expect((await admin.get("/me")).body.newSuggestions).toBe(before + 1);
    expect((await p.get("/me")).body.newSuggestions).toBe(0);
    expect((await p.get("/admin/suggestions")).status).toBe(403);

    const list = await admin.get("/admin/suggestions");
    const mine = list.body.items.find((x: { id: number }) => x.id === sent.body.id);
    expect(mine).toMatchObject({ seen: false, author: { username: p.username } });
    expect((await admin.post("/admin/suggestions/seen")).status).toBe(200);
    expect((await admin.get("/me")).body.newSuggestions).toBe(0);

    const answered = await admin.patch(`/admin/suggestions/${sent.body.id}`, {
      status: "accepted",
      reply: "Bonne idée, prévu pour novembre !",
    });
    expect(answered.body).toMatchObject({ status: "accepted", reply: "Bonne idée, prévu pour novembre !" });
    expect(answered.body.repliedAt).not.toBeNull();
    const notifs = await p.get("/notifications");
    // Statut et réponse envoyés ensemble : une seule notification.
    expect(notifs.body.items.filter((x: { type: string }) => x.type === "suggestion_update")).toHaveLength(1);
    expect(notifs.body.items[0]).toMatchObject({
      type: "suggestion_update",
      payload: { suggestionId: sent.body.id, status: "accepted", replied: true },
    });

    // Statut puis réponse en deux fois, avant lecture : toujours une seule notification, qui garde la réponse.
    await admin.patch(`/admin/suggestions/${sent.body.id}`, { status: "done" });
    const merged = (await p.get("/notifications")).body.items.filter(
      (x: { type: string }) => x.type === "suggestion_update",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].payload).toMatchObject({ status: "done", replied: true });

    // Rien ne change : pas de nouvelle notification.
    await admin.patch(`/admin/suggestions/${sent.body.id}`, { status: "done" });
    expect((await p.get("/notifications")).body.items.length).toBe(notifs.body.items.length);

    expect((await admin.del(`/admin/suggestions/${sent.body.id}`)).status).toBe(200);
    expect((await p.get("/suggestions")).body).toEqual([]);
  });

  it("refuse une suggestion vide ou trop courte, sans plafond par jour", async () => {
    const p = await signUp(app);
    expect((await p.post("/suggestions", { kind: "bug", title: "Bug", body: "court" })).status).toBe(400);
    expect(
      (await p.post("/suggestions", { kind: "nope", title: "Un titre", body: "Un texte assez long." })).status,
    ).toBe(400);
    // L'ancien plafond était de 5 par jour : la 6e et les suivantes passent aussi.
    for (let i = 0; i < 7; i++) {
      const r = await p.post("/suggestions", { kind: "bug", title: `Bug n° ${i}`, body: "Le bouton ne répond pas." });
      expect(r.status).toBe(200);
    }
    expect((await p.get("/suggestions")).body).toHaveLength(7);
  });

  it("bandeau : pas le premier jour, puis caché une semaine quand on le ferme ou qu'on envoie une idée", async () => {
    const p = await signUp(app);
    expect((await p.get("/me")).body.suggestionBanner).toBe(false);
    await ageAccount(p.userId);
    expect((await p.get("/me")).body.suggestionBanner).toBe(true);

    expect((await p.post("/suggestions/banner/dismiss")).status).toBe(200);
    expect((await p.get("/me")).body.suggestionBanner).toBe(false);
    const [row] = await ctx.db
      .select({ until: schema.players.suggestionBannerUntil })
      .from(schema.players)
      .where(eq(schema.players.userId, p.userId));
    const days = (row!.until!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    // Une semaine plus tard, il revient.
    await ctx.db
      .update(schema.players)
      .set({ suggestionBannerUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.players.userId, p.userId));
    expect((await p.get("/me")).body.suggestionBanner).toBe(true);

    await p.post("/suggestions", { kind: "feature", title: "Mode sombre auto", body: "Suivre l'heure du coucher." });
    expect((await p.get("/me")).body.suggestionBanner).toBe(false);
  });
});
