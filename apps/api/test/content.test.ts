import { eq, schema, sql } from "@palacards/db";
import { BOSS_REWARDS, passReward, xpForLevel } from "@palacards/game";
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
    expect(await ledgerSum(p.userId, "quest")).toBe(after.daily[0].reward.pw);
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

describe("article du jour", () => {
  it("dévoile un indice par erreur et paie la bonne réponse selon le nombre d'essais", async () => {
    const p = await signUp(app);
    const start = (await p.get("/article")).body;
    expect(start.clues).toHaveLength(1);
    expect(start.answer).toBeNull();
    expect(start.nextReward).toBe(100);
    const wrong = await p.post("/article/guess", { guess: "Pas du tout ça" });
    expect(wrong.body.clues).toHaveLength(2);
    expect(wrong.body.nextReward).toBe(90);
    expect((await p.post("/article/guess", { guess: "pas du tout ça" })).status).toBe(409);
    const [a] = await ctx.db.select().from(schema.dailyArticles).limit(1);
    const done = await p.post("/article/guess", { guess: a!.title.toUpperCase() });
    expect(done.body).toMatchObject({ found: true, finished: true, reward: 90 });
    expect(done.body.answer.title).toBe(a!.title);
    expect(done.body.share).toBe("🟥🟩⬜⬜⬜⬜");
    expect(await ledgerSum(p.userId, "daily_article")).toBe(90);
    expect((await p.post("/article/guess", { guess: "encore" })).status).toBe(409);
    expect((await p.get("/me")).body.articleReady).toBe(false);
    await progressionIdle();
    const stats = await ctx.db.select().from(schema.playerStats).where(eq(schema.playerStats.userId, p.userId));
    expect(stats.find((s) => s.key === "articles_found")?.value).toBe(1);
  });

  it("termine la partie au sixième essai raté, sans gain", async () => {
    const p = await signUp(app);
    let last;
    for (let i = 0; i < 6; i++) last = await p.post("/article/guess", { guess: `mauvaise réponse ${i}` });
    expect(last!.body).toMatchObject({ found: false, finished: true, reward: 0 });
    expect(last!.body.answer).not.toBeNull();
    expect(await ledgerSum(p.userId, "daily_article")).toBe(0);
  });
});

describe("boss du jour", () => {
  async function fiveCards(p: Client) {
    await openPacks(p, 1);
    const col = (await p.get("/collection?limit=10")).body.items as { instanceId: number }[];
    return col.slice(0, 5).map((c) => c.instanceId);
  }

  /** Répond juste à chaque question en lisant la bonne réponse en base (test). */
  async function playAssault(p: Client, right = true) {
    let state = (await p.get("/boss")).body;
    while (state.current && !state.current.finished) {
      const q = state.current.question;
      if (!q) {
        state = (await p.post(`/boss/assault/${state.current.id}/next`)).body;
        continue;
      }
      const [hit] = await ctx.db.execute<{ question: { answer: number } }>(
        sql`select question from boss_hits where assault_id = ${state.current.id} and idx = ${q.idx}`,
      );
      const choice = right ? hit!.question.answer : (hit!.question.answer + 1) % q.choices.length;
      await p.post(`/boss/assault/${state.current.id}/answer`, { idx: q.idx, choice });
      state = (await p.post(`/boss/assault/${state.current.id}/next`)).body;
    }
    return state;
  }

  it("retire des PV à chaque bonne réponse et limite les assauts à deux par jour", async () => {
    const p = await signUp(app);
    const ids = await fiveCards(p);
    const before = (await p.get("/boss")).body;
    expect(before.assaultsUsed).toBe(0);
    const started = await p.post("/boss/assault", { instanceIds: ids });
    expect(started.status).toBe(200);
    expect(started.body.current.question).not.toBeNull();
    expect((await p.post("/boss/assault", { instanceIds: ids })).status).toBe(409);
    const after = await playAssault(p, true);
    expect(after.current.finished).toBe(true);
    expect(after.current.hits).toHaveLength(5);
    expect(after.myDamage).toBeGreaterThan(0);
    expect(after.hp).toBeLessThan(before.hp);
    expect((await p.post("/boss/assault", { instanceIds: ids })).status).toBe(200);
    await playAssault(p, false);
    expect((await p.post("/boss/assault", { instanceIds: ids })).status).toBe(409);
    expect((await p.get("/me")).body.boss.assaultsLeft).toBe(0);
  });

  it("cache la carte pendant une question qu'elle trahirait (image, « Qui suis-je ? »)", async () => {
    const p = await signUp(app);
    const started = (await p.post("/boss/assault", { instanceIds: await fiveCards(p) })).body;
    const { id } = started.current;
    const idx = started.current.question.idx as number;
    const visible = started.current.question.cardHidden ? null : started.current.question.card.title;
    await ctx.db.execute(
      sql`update boss_hits set question = jsonb_set(question, '{type}', '"image"') where assault_id = ${id} and idx = ${idx}`,
    );
    const q = (await p.get("/boss")).body.current.question;
    expect(q.cardHidden).toBe(true);
    expect(q.card).toMatchObject({ title: "", thumbUrl: null, pageUrl: null, cardId: 0, instanceId: null });
    expect(q.card.rarity).toBeTruthy();
    await p.post(`/boss/assault/${id}/answer`, { idx, choice: 0 });
    const hit = (await p.get("/boss")).body.current.hits[0];
    expect(hit.card.title).not.toBe("");
    if (visible) expect(hit.card.title).toBe(visible);
  });

  it("paie tous les participants quand le boss tombe", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const idsA = await fiveCards(a);
    const idsB = await fiveCards(b);
    // B a déjà participé ; on met le boss à 1 PV pour que le premier coup juste de A le tue.
    await b.post("/boss/assault", { instanceIds: idsB });
    await playAssault(b, false);
    const day = (await a.get("/boss")).body.day as string;
    await ctx.db.update(schema.bossDays).set({ hp: 1 }).where(eq(schema.bossDays.day, day));
    await a.post("/boss/assault", { instanceIds: idsA });
    const end = await playAssault(a, true);
    expect(end.hp).toBe(0);
    expect(end.killedAt).not.toBeNull();
    await progressionIdle();
    for (const p of [a, b]) {
      expect(await ledgerSum(p.userId, "boss")).toBe(BOSS_REWARDS.kill.pw);
      expect(await ledgerSum(p.userId, "boss", "bonus_pack")).toBeGreaterThanOrEqual(BOSS_REWARDS.kill.packs);
    }
    // Les vieux participants (assauts précédents) sont payés aussi : on ne repaie personne deux fois.
    await ctx.db.update(schema.bossDays).set({ hp: 0 }).where(eq(schema.bossDays.day, day));
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
});
