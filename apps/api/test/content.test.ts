import { eq, schema, sql } from "@palacards/db";
import { passReward, xpForLevel } from "@palacards/game";
import type { QuestDTO } from "@palacards/shared";
import { afterAll, describe, expect, it } from "vitest";
import { STATS_VERSION, progressionIdle } from "../src/services/progression.js";
import { achievementPw, makeApp, signUp, signUpAdmin, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

const ledgerSum = async (userId: string, reason: string, kind = "pw") => {
  const [row] = await ctx.db.execute<{ n: string }>(
    sql`select coalesce(sum(delta), 0) as n from ledger where user_id = ${userId} and kind = ${kind} and reason = ${reason}`,
  );
  return Number(row?.n ?? 0);
};

/** Ouvre `n` paquets (bonus donnés au besoin : le stock gratuit est de 30). */
async function openPacks(p: Client, n: number) {
  await ctx.db.update(schema.players).set({ bonusPacks: n }).where(eq(schema.players.userId, p.userId));
  for (let i = 0; i < n; i++) expect((await p.post("/packs/open")).status).toBe(200);
  await progressionIdle();
}

describe("quêtes du jour et de la semaine", () => {
  it("donne trois quêtes du jour et une de la semaine, qui avancent avec les paquets", async () => {
    const p = await signUp(app);
    const before = (await p.get("/quests")).body;
    expect(before.daily).toHaveLength(3);
    expect(before.daily.map((q: { tier: string }) => q.tier)).toEqual(["easy", "medium", "hard"]);
    expect(before.weekly).not.toBeNull();
    expect(before.rerollAvailable).toBe(true);
    // Une quête « Ouvrir N paquets » est forcée sur le premier créneau pour le test.
    await ctx.db.execute(sql`
      update player_quests set kind = 'open_packs', target = 2, progress = 0
      where user_id = ${p.userId} and period = 'day' and slot = 1
    `);
    await openPacks(p, 2);
    const after = (await p.get("/quests")).body;
    expect(after.daily[0]).toMatchObject({ kind: "open_packs", progress: 2, target: 2 });
    expect(after.daily[0].completedAt).not.toBeNull();
    // Les autres quêtes tirées au hasard (« tirer une SR »…) peuvent aussi se terminer avec ces paquets.
    const done = [...after.daily, after.weekly].filter((q: QuestDTO | null) => q?.completedAt) as QuestDTO[];
    expect(await ledgerSum(p.userId, "quest")).toBe(done.reduce((sum, q) => sum + q.reward.pw, 0));
    const me = (await p.get("/me")).body;
    expect(me.quests.done).toBeGreaterThanOrEqual(1);
    expect(me.quests.total).toBe(4);
  });

  it("change une quête une fois par jour", async () => {
    const p = await signUp(app);
    const before = (await p.get("/quests")).body;
    const res = await p.post("/quests/2/reroll");
    expect(res.status).toBe(200);
    expect(res.body.daily[1].kind).not.toBe(before.daily[1].kind);
    expect(res.body.daily[1].rerolled).toBe(true);
    expect(res.body.rerollAvailable).toBe(false);
    expect((await p.post("/quests/1/reroll")).status).toBe(409);
  });
});

describe("passe de saison", () => {
  it("donne de l'XP par paquet et paie chaque niveau franchi une seule fois", async () => {
    const p = await signUp(app);
    // Juste sous le niveau 1 : un paquet (10 XP) le fait franchir.
    await ctx.db.execute(sql`
      update players set season_xp = ${xpForLevel(1) - 5}, pass_season = (select id from seasons where status = 'active')
      where user_id = ${p.userId}
    `);
    await openPacks(p, 1);
    const pass = (await p.get("/pass")).body;
    expect(pass.level).toBe(1);
    expect(pass.levels).toHaveLength(100);
    const reward = passReward(1);
    expect(await ledgerSum(p.userId, "season_pass", "bonus_pack")).toBe(reward.packs);
    // Un autre paquet ne repaie pas le niveau 1.
    await openPacks(p, 1);
    expect(await ledgerSum(p.userId, "season_pass", "bonus_pack")).toBe(reward.packs);
    expect((await p.get("/me")).body.pass.level).toBe(1);
    const board = (await p.get("/leaderboard?board=pass")).body;
    expect(board.rows.find((r: { me: boolean }) => r.me)?.value).toBe(1);
  });
});

describe("succès à paliers : rattrapage des anciens joueurs", () => {
  it("débloque et paie d'un coup les paliers déjà atteints, une seule fois", async () => {
    const p = await signUp(app);
    // Un ancien joueur : 12 paquets déjà ouverts (lignes de ledger), « Premier paquet » déjà débloqué.
    await openPacks(p, 12);
    await ctx.db.execute(
      sql`delete from achievements_progress where user_id = ${p.userId} and achievement_key <> 'first_pack'`,
    );
    await ctx.db.execute(sql`delete from player_stats where user_id = ${p.userId}`);
    await ctx.db.execute(
      sql`delete from ledger where user_id = ${p.userId} and reason = 'achievement' and ref_id <> 'first_pack'`,
    );
    await ctx.db.execute(sql`update players set stats_version = 0 where user_id = ${p.userId}`);
    const pwBefore = await achievementPw(ctx, p.userId);
    await p.get("/me");
    await progressionIdle();
    const list = (await p.get("/achievements")).body as { key: string; unlockedAt: string | null }[];
    expect(list.find((a) => a.key === "packs_10")?.unlockedAt).not.toBeNull();
    expect(list.find((a) => a.key === "packs_100")?.unlockedAt).toBeNull();
    // `first_pack` n'est pas repayé.
    const [first] = await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from ledger where user_id = ${p.userId} and reason = 'achievement' and ref_id = 'first_pack'`,
    );
    expect(first!.n).toBe(1);
    expect(await achievementPw(ctx, p.userId)).toBeGreaterThan(pwBefore);
    const [player] = await ctx.db.select().from(schema.players).where(eq(schema.players.userId, p.userId));
    expect(player!.statsVersion).toBe(STATS_VERSION);
    const notes = (await p.get("/notifications")).body.items as { type: string }[];
    expect(notes.some((n) => n.type === "achievement_backfill")).toBe(true);
    // Deuxième visite : rien de plus.
    const paid = await achievementPw(ctx, p.userId);
    await p.get("/me");
    await progressionIdle();
    expect(await achievementPw(ctx, p.userId)).toBe(paid);
  });

  it("cache le nom des succès secrets tant qu'ils ne sont pas débloqués", async () => {
    const p = await signUp(app);
    const list = (await p.get("/achievements")).body as { key: string; secret: boolean; name: string }[];
    expect(list.length).toBeGreaterThanOrEqual(100);
    const secret = list.find((a) => a.key === "secret_meta")!;
    expect(secret.secret).toBe(true);
    expect(secret.name).toBe("Succès secret");
  });
});

describe("fil d'activité", () => {
  it("liste les meilleurs tirages, les brillantes et les tirages bizarres, avec réactions", async () => {
    const p = await signUp(app);
    const q = await signUp(app);
    await openPacks(p, 2);
    const [pull] = await ctx.db.execute<{ id: string }>(
      sql`select id from pulls where user_id = ${p.userId} order by id limit 1`,
    );
    const id = Number(pull!.id);
    await ctx.db.execute(sql`update pulls set shiny = true, rarity = 'L', genres = '{ww2}' where id = ${id}`);
    const best = (await q.get("/feed?kind=best")).body;
    expect(best.items[0].card.rarity).toBe("L");
    const shiny = (await q.get("/feed?kind=shiny")).body;
    expect(shiny.items.some((i: { id: number }) => i.id === id)).toBe(true);
    const weird = (await q.get("/feed?kind=weird&genre=ww2")).body;
    expect(weird.items.some((i: { id: number; genres: string[] }) => i.id === id && i.genres.includes("ww2"))).toBe(
      true,
    );
    expect((await q.get("/feed?kind=weird&genre=inconnu")).status).toBe(400);
    const react = await q.post(`/feed/${id}/react`, { emoji: "🔥" });
    expect(react.body.reactions).toEqual([{ emoji: "🔥", count: 1, mine: true }]);
    const undo = await q.post(`/feed/${id}/react`, { emoji: "🔥" });
    expect(undo.body.reactions).toEqual([]);
    expect((await q.post(`/feed/${id}/react`, { emoji: "🙂" })).status).toBe(400);
  });
});

describe("messages serveur", () => {
  it("garde le message pour les absents jusqu'à ce qu'ils le ferment", async () => {
    const admin = await signUpAdmin(app, ctx);
    const p = await signUp(app);
    expect((await p.post("/admin/broadcasts", { title: "Coucou", body: "Test" })).status).toBe(403);
    const draft = await admin.post("/admin/broadcasts", { title: "Grosse mise à jour", body: "Les quêtes sont là !" });
    expect(draft.status).toBe(200);
    expect((await p.get("/broadcasts/pending")).body).toEqual([]);
    expect((await admin.post(`/admin/broadcasts/${draft.body.id}/send`)).status).toBe(200);
    expect((await admin.post(`/admin/broadcasts/${draft.body.id}/send`)).status).toBe(409);
    const pending = (await p.get("/broadcasts/pending")).body;
    expect(pending.map((m: { title: string }) => m.title)).toContain("Grosse mise à jour");
    await p.post(`/broadcasts/${draft.body.id}/read`);
    expect((await p.get("/broadcasts/pending")).body.some((m: { id: number }) => m.id === draft.body.id)).toBe(false);
    const list = (await admin.get("/admin/broadcasts")).body;
    expect(list.find((m: { id: number }) => m.id === draft.body.id)).toMatchObject({ status: "sent", reads: 1 });
    // Archivé : plus montré à personne.
    const other = await signUp(app);
    await admin.post(`/admin/broadcasts/${draft.body.id}/archive`);
    expect((await other.get("/broadcasts/pending")).body.some((m: { id: number }) => m.id === draft.body.id)).toBe(
      false,
    );
    expect(
      (await admin.post("/admin/broadcasts", { title: "x", body: "y", linkUrl: "javascript:alert(1)" })).status,
    ).toBe(400);
  });

  it("garde l'historique des messages envoyés pour la page Mises à jour", async () => {
    const admin = await signUpAdmin(app, ctx);
    const p = await signUp(app);
    const first = await admin.post("/admin/broadcasts", {
      title: "Historique 1",
      body: "Un",
      tone: "update",
      send: true,
    });
    const second = await admin.post("/admin/broadcasts", {
      title: "Historique 2",
      body: "• Deux\n• Trois",
      tone: "event",
      linkUrl: "/boss",
      linkLabel: "Voir le boss",
      send: true,
    });
    const draft = await admin.post("/admin/broadcasts", { title: "Historique brouillon", body: "Pas encore" });
    const archived = await admin.post("/admin/broadcasts", { title: "Historique archivé", body: "Retiré", send: true });
    await admin.post(`/admin/broadcasts/${archived.body.id}/archive`);

    // Même un message déjà fermé reste lisible dans l'historique, du plus récent au plus ancien.
    await p.post(`/broadcasts/${first.body.id}/read`);
    const list = (await p.get("/broadcasts")).body as { id: number; title: string }[];
    const ids = list.map((m) => m.id);
    expect(ids).toContain(first.body.id);
    expect(ids.indexOf(second.body.id)).toBeLessThan(ids.indexOf(first.body.id));
    expect(ids).not.toContain(draft.body.id);
    expect(ids).not.toContain(archived.body.id);
    expect(list.find((m) => m.id === second.body.id)).toMatchObject({
      tone: "event",
      linkUrl: "/boss",
      linkLabel: "Voir le boss",
    });
  });
});
