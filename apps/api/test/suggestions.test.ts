import { eq, schema } from "@palacards/db";
import { afterAll, describe, expect, it } from "vitest";
import { progressionIdle } from "../src/services/progression.js";
import { achievementPw, makeApp, signUp, signUpAdmin, type Client } from "./helpers.js";

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
    // Le succès « Boîte à idées » tombe en arrière-plan (sa propre notification).
    await progressionIdle();
    const notifs = await p.get("/notifications");
    // Statut et réponse envoyés ensemble : une seule notification.
    expect(notifs.body.items.filter((x: { type: string }) => x.type === "suggestion_update")).toHaveLength(1);
    expect(notifs.body.items.find((x: { type: string }) => x.type === "suggestion_update")).toMatchObject({
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
    await progressionIdle();
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

describe("succès « Boîte à idées »", () => {
  const ideas = async (p: Client) =>
    ((await p.get("/achievements")).body as { key: string; progress: number; unlockedAt: string | null }[]).filter(
      (a) => a.key.startsWith("ideas_"),
    );
  const send = async (p: Client, i: number) =>
    (await p.post("/suggestions", { kind: "feature", title: `Idée n° ${i}`, body: "Une idée assez détaillée." })).body
      .id as number;

  it("ne compte que les suggestions acceptées ou réalisées, donne un badge sans PW, une fois par palier", async () => {
    const p = await signUp(app);
    const admin = await signUpAdmin(app, ctx);
    await p.get("/me");
    await progressionIdle();
    const pw = await achievementPw(ctx, p.userId);

    // Envoyer en rafale ne fait rien avancer ; une suggestion refusée non plus.
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) ids.push(await send(p, i));
    await admin.patch(`/admin/suggestions/${ids[0]}`, { status: "declined" });
    await progressionIdle();
    expect((await ideas(p)).map((a) => a.progress)).toEqual([0, 0, 0]);
    expect((await p.get(`/players/${p.username}`)).body.badge).toBeNull();

    // Acceptée puis réalisée : un seul palier, une seule notification.
    await admin.patch(`/admin/suggestions/${ids[1]}`, { status: "accepted" });
    await admin.patch(`/admin/suggestions/${ids[1]}`, { status: "done" });
    await progressionIdle();
    let list = await ideas(p);
    expect(list[0]!.unlockedAt).not.toBeNull();
    expect(list[1]).toMatchObject({ progress: 1, unlockedAt: null });
    const notes = (await p.get("/notifications")).body.items as { type: string; payload: { key?: string } }[];
    expect(notes.filter((n) => n.type === "achievement" && n.payload.key === "ideas_1")).toHaveLength(1);
    expect((await p.get(`/players/${p.username}`)).body.badge).toEqual({ name: "Bonne idée", tier: 0 });

    // Repasser en « refusée » ne retire rien ; cinq retenues : palier suivant et badge argent.
    await admin.patch(`/admin/suggestions/${ids[1]}`, { status: "declined" });
    for (const id of ids.slice(1)) await admin.patch(`/admin/suggestions/${id}`, { status: "accepted" });
    await progressionIdle();
    list = await ideas(p);
    expect(list.map((a) => !!a.unlockedAt)).toEqual([true, true, false]);
    expect(list[2]!.progress).toBe(5);
    expect((await p.get(`/players/${p.username}`)).body.badge).toEqual({ name: "Force de proposition", tier: 1 });
    // Récompense cosmétique : aucun PW versé.
    expect(await achievementPw(ctx, p.userId)).toBe(pw);
  });

  it("rattrape les suggestions déjà retenues des anciens joueurs", async () => {
    const p = await signUp(app);
    const id = await send(p, 1);
    await ctx.db.update(schema.suggestions).set({ status: "done" }).where(eq(schema.suggestions.id, id));
    await ctx.db.update(schema.players).set({ statsVersion: 0 }).where(eq(schema.players.userId, p.userId));
    await p.get("/me");
    await progressionIdle();
    expect((await ideas(p))[0]!.unlockedAt).not.toBeNull();
  });
});
