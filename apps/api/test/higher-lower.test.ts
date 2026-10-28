import { and, eq, schema, sql } from "@palacards/db";
import { HL_TRIES_PER_DAY, hlReward } from "@palacards/game";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "../src/context.js";
import { sweepHigherLower } from "../src/services/higher-lower.js";
import { progressionIdle } from "../src/services/progression.js";
import { makeApp, signUp, type Client } from "./helpers.js";

let app: Awaited<ReturnType<typeof makeApp>>["app"];
let ctx: Ctx;
let clock: Ctx["now"];

/** Marque des résumés créés ici (retirés à la fin : la base de test est partagée). */
const MARK = "hl-test";

beforeAll(async () => {
  ({ app, ctx } = await makeApp());
  clock = ctx.now;
  await ctx.db.execute(sql`
    insert into wiki_summaries (page_id, extract, thumb_url, description, status, arthropod)
    select c.id, ${MARK}, 'https://upload.wikimedia.org/hl/' || c.id || '.jpg', 'article de test', 'ok', false
    from cards c
    where c.season = (select id from seasons where status = 'active') and c.rarity in ('SR', 'UR', 'L')
    on conflict (page_id) do nothing
  `);
  // Base de test : vues presque identiques (4 900 à 5 000). On les étale (×1,08 d'un article à l'autre, comme
  // les vraies, de 22 500 à des millions), puis on les remet à la fin. Saison par saison : d'autres fichiers en
  // créent, et un seul classement toutes saisons confondues dépasserait 10¹² vues (hors de portée du serveur).
  await ctx.db.execute(sql`drop table if exists hl_test_views`);
  await ctx.db.execute(sql`
    create table hl_test_views as
    select id, season, views_12m from cards where rarity in ('SR', 'UR', 'L')
  `);
  await ctx.db.execute(sql`
    update cards c set views_12m = (22500 * power(1.08, r.n))::bigint
    from (select id, season, row_number() over (partition by season order by views_12m, id) as n from cards where rarity in ('SR', 'UR', 'L')) r
    where c.id = r.id and c.season = r.season
  `);
});
afterEach(() => {
  ctx.now = clock;
});
afterAll(async () => {
  await ctx.db.execute(sql`delete from wiki_summaries where extract = ${MARK}`);
  await ctx.db.execute(
    sql`update cards c set views_12m = v.views_12m from hl_test_views v where c.id = v.id and c.season = v.season`,
  );
  await ctx.db.execute(sql`drop table hl_test_views`);
  await app.close();
});

/** Côté le plus vu de la paire en cours, lu en base (le client ne le sait jamais). */
async function higherSide(p: Client): Promise<"kept" | "challenger"> {
  return (await p.get("/test/hl-answer")).body.higher;
}
const other = (s: "kept" | "challenger") => (s === "kept" ? "challenger" : "kept");

async function hlPw(userId: string) {
  const [row] = await ctx.db.execute<{ n: string; rows: number }>(sql`
    select coalesce(sum(delta), 0) as n, count(*)::int as rows from ledger where user_id = ${userId} and reason = 'higher_lower'
  `);
  return { pw: Number(row!.n), rows: row!.rows };
}

describe("plus ou moins vu", () => {
  it("une paire sans vues ni rareté ; bonne réponse : vues révélées, série +1, le plus vu reste", async () => {
    const p = await signUp(app);
    const start = await p.post("/hl/start");
    expect(start.status).toBe(200);
    const pair = start.body.current;
    expect(Object.keys(pair.kept).sort()).toEqual(["description", "thumbUrl", "title"]);
    const raw = JSON.stringify(start.body);
    expect(raw).not.toMatch(/views|rarity|cardId|"SR"|"UR"|"L"/);
    expect(pair).toMatchObject({ tryNo: 1, step: 0, streak: 0, durationMs: 15_000 });

    // Paire en milieu de pool : le plus vu a forcément un adversaire dans les deux sens (en haut du pool, il
    // laisserait place à une paire entièrement nouvelle, cas testé plus bas).
    const mid = await ctx.db.execute<{ id: string }>(sql`
      select c.id from cards c join wiki_summaries s on s.page_id = c.id and s.extract = ${MARK}
      where c.season = (select id from seasons where status = 'active') and c.rarity in ('SR', 'UR', 'L')
      order by c.views_12m desc offset 40 limit 2
    `);
    await ctx.db
      .update(schema.hlRuns)
      .set({ keptCardId: Number(mid[0]!.id), challengerCardId: Number(mid[1]!.id) })
      .where(eq(schema.hlRuns.userId, p.userId));
    const current = (await p.get("/hl")).body.current;
    const side = await higherSide(p);
    const winner = current[side].title;
    const res = await p.post("/hl/answer", { step: 0, pick: side });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ correct: true, timeout: false, streak: 1, reward: null });
    const { kept, challenger } = res.body.reveal;
    expect(Math.max(kept.views, challenger.views)).toBe(side === "kept" ? kept.views : challenger.views);
    expect(res.body.next).toMatchObject({ step: 1, streak: 1 });
    expect(res.body.next.kept.title).toBe(winner);
    expect(JSON.stringify(res.body.next)).not.toMatch(/views|rarity/);
  });

  it("mauvaise réponse : l'essai s'arrête et paie sa série, une seule fois", async () => {
    const p = await signUp(app);
    await p.post("/hl/start");
    for (let step = 0; step < 2; step++) {
      const ok = await p.post("/hl/answer", { step, pick: await higherSide(p) });
      expect(ok.body.correct).toBe(true);
    }
    const before = (await p.get("/me")).body.wallet.balance;
    const wrong = await p.post("/hl/answer", { step: 2, pick: other(await higherSide(p)) });
    expect(wrong.body).toMatchObject({ correct: false, timeout: false, streak: 2, reward: hlReward(2), next: null });
    expect((await p.get("/me")).body.wallet.balance).toBe(before + hlReward(2));
    expect(await hlPw(p.userId)).toEqual({ pw: hlReward(2), rows: 1 });
    expect((await p.post("/hl/answer", { step: 2, pick: "kept" })).body.error).toBe("hl_no_run");
    expect(wrong.body.state).toMatchObject({ triesLeft: HL_TRIES_PER_DAY - 1, todayBest: 2, current: null });
  });

  it("chrono dépassé (15 s + 1 s de marge) : défaite, même avec la bonne réponse", async () => {
    const p = await signUp(app);
    await p.post("/hl/start");
    const side = await higherSide(p);
    // 16,5 s plus tard.
    ctx.now = () => new Date(Date.now() + 16_500);
    const res = await p.post("/hl/answer", { step: 0, pick: side });
    expect(res.body).toMatchObject({ correct: false, timeout: true, streak: 0, reward: 0 });
    const [run] = await ctx.db.select().from(schema.hlRuns).where(eq(schema.hlRuns.userId, p.userId));
    expect(run).toMatchObject({ status: "over", endReason: "timeout" });
  });

  it("dans la marge d'une seconde : la réponse compte encore", async () => {
    const p = await signUp(app);
    await p.post("/hl/start");
    const side = await higherSide(p);
    ctx.now = () => new Date(Date.now() + 15_500);
    expect((await p.post("/hl/answer", { step: 0, pick: side })).body.correct).toBe(true);
  });

  it("quitter la page ne met pas le chrono en pause : l'essai échu se termine tout seul", async () => {
    const p = await signUp(app);
    await p.post("/hl/start");
    await p.post("/hl/answer", { step: 0, pick: await higherSide(p) });
    ctx.now = () => new Date(Date.now() + 60_000);
    await sweepHigherLower(ctx);
    const [run] = await ctx.db.select().from(schema.hlRuns).where(eq(schema.hlRuns.userId, p.userId));
    expect(run).toMatchObject({ status: "over", endReason: "timeout", streak: 1, reward: hlReward(1) });
    expect(await hlPw(p.userId)).toEqual({ pw: hlReward(1), rows: 1 });
    // Relecture de l'état ou nouveau passage du job : rien de plus.
    await p.get("/hl");
    await sweepHigherLower(ctx);
    expect(await hlPw(p.userId)).toEqual({ pw: hlReward(1), rows: 1 });
  });

  it("3 essais par jour, et jamais deux fois le même article dans la journée", async () => {
    const p = await signUp(app);
    const shown: string[] = [];
    for (let i = 0; i < HL_TRIES_PER_DAY; i++) {
      const start = await p.post("/hl/start");
      expect(start.status).toBe(200);
      let pair = start.body.current;
      shown.push(pair.kept.title, pair.challenger.title);
      const ok = await p.post("/hl/answer", { step: 0, pick: await higherSide(p) });
      pair = ok.body.next;
      if (pair) {
        shown.push(pair.challenger.title);
        await p.post("/hl/answer", { step: 1, pick: other(await higherSide(p)) });
      }
    }
    expect(new Set(shown).size).toBe(shown.length);
    const state = (await p.get("/hl")).body;
    expect(state).toMatchObject({ triesLeft: 0, current: null });
  });

  it("nouvelle journée (minuit, heure de Paris) : 3 nouveaux essais", async () => {
    const p = await signUp(app);
    ctx.now = () => new Date("2026-10-22T21:50:00Z");
    for (let i = 0; i < HL_TRIES_PER_DAY; i++) {
      await p.post("/hl/start");
      await p.post("/hl/answer", { step: 0, pick: other(await higherSide(p)) });
    }
    // Après les 3 essais : entraînement seulement.
    const practice = await p.post("/hl/start");
    expect(practice.body.current.practice).toBe(true);
    await p.post("/hl/answer", { step: 0, pick: other(await higherSide(p)) });
    ctx.now = () => new Date("2026-10-22T22:05:00Z");
    const next = await p.post("/hl/start");
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ triesLeft: HL_TRIES_PER_DAY - 1, current: { tryNo: 1, practice: false } });
  });

  it("réponses concurrentes : une seule compte, la récompense n'est versée qu'une fois", async () => {
    const p = await signUp(app);
    await p.post("/hl/start");
    await p.post("/hl/answer", { step: 0, pick: await higherSide(p) });
    const wrong = other(await higherSide(p));
    const results = await Promise.all(Array.from({ length: 5 }, () => p.post("/hl/answer", { step: 1, pick: wrong })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await hlPw(p.userId)).toEqual({ pw: hlReward(1), rows: 1 });
  });

  it("réponse en double sur une paire déjà jouée : refusée, la paire suivante n'est pas touchée", async () => {
    const p = await signUp(app);
    await p.post("/hl/start");
    const side = await higherSide(p);
    const [a, b] = await Promise.all([
      p.post("/hl/answer", { step: 0, pick: side }),
      p.post("/hl/answer", { step: 0, pick: side }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [run] = await ctx.db.select().from(schema.hlRuns).where(eq(schema.hlRuns.userId, p.userId));
    expect(run).toMatchObject({ status: "playing", step: 1, streak: 1 });
  });

  it("masquer les arthropodes : aucun article d'arthropode connu", async () => {
    const p = await signUp(app);
    await ctx.db.update(schema.players).set({ hideArthropods: true }).where(eq(schema.players.userId, p.userId));
    // La moitié du pool devient « arthropode ».
    await ctx.db.execute(sql`update wiki_summaries set arthropod = (page_id % 2 = 0) where extract = ${MARK}`);
    try {
      await p.post("/hl/start");
      const [run] = await ctx.db.select().from(schema.hlRuns).where(eq(schema.hlRuns.userId, p.userId));
      expect(run!.keptCardId % 2).toBe(1);
      expect(run!.challengerCardId % 2).toBe(1);
    } finally {
      await ctx.db.execute(sql`update wiki_summaries set arthropod = false where extract = ${MARK}`);
    }
  });

  it("le succès « série de 5 » et la meilleure série du mois", async () => {
    const p = await signUp(app);
    await p.post("/hl/start");
    let step = 0;
    for (; step < 5; step++) {
      const r = await p.post("/hl/answer", { step, pick: await higherSide(p) });
      if (!r.body.next) break;
    }
    if (step === 5) await p.post("/hl/answer", { step, pick: other(await higherSide(p)) });
    const [run] = await ctx.db
      .select()
      .from(schema.hlRuns)
      .where(and(eq(schema.hlRuns.userId, p.userId), eq(schema.hlRuns.status, "over")));
    const board = (await p.get("/leaderboard?board=hl_streak")).body.rows;
    expect(board.find((r: { me: boolean }) => r.me)).toMatchObject({ value: run!.streak });
  });

  it("après les 3 essais : entraînement à volonté, sans PW, XP, quêtes, succès ni classement", async () => {
    const p = await signUp(app);
    for (let i = 0; i < HL_TRIES_PER_DAY; i++) {
      await p.post("/hl/start");
      await p.post("/hl/answer", { step: 0, pick: await higherSide(p) });
      await p.post("/hl/answer", { step: 1, pick: other(await higherSide(p)) });
    }
    const paid = await hlPw(p.userId);
    expect(paid).toEqual({ pw: HL_TRIES_PER_DAY * hlReward(1), rows: HL_TRIES_PER_DAY });
    await progressionIdle();
    const xpBefore = (await ctx.db.select().from(schema.players).where(eq(schema.players.userId, p.userId)))[0]!
      .seasonXp;

    // Deux parties d'entraînement, dont une série de 6 (plus haut que la meilleure série officielle).
    for (let game = 0; game < 2; game++) {
      const start = await p.post("/hl/start");
      expect(start.status).toBe(200);
      expect(start.body).toMatchObject({ triesLeft: 0, current: { practice: true, reward: 0, nextReward: 0 } });
      const wins = game === 0 ? 6 : 0;
      for (let step = 0; step < wins; step++) {
        const r = await p.post("/hl/answer", { step, pick: await higherSide(p) });
        expect(r.body.correct).toBe(true);
        if (!r.body.next) break;
      }
      const end = await p.post("/hl/answer", { step: wins, pick: other(await higherSide(p)) });
      expect(end.body).toMatchObject({ correct: false, reward: 0, next: null });
    }
    expect(await hlPw(p.userId)).toEqual(paid);
    await progressionIdle();
    const player = (await ctx.db.select().from(schema.players).where(eq(schema.players.userId, p.userId)))[0]!;
    expect(player.seasonXp).toBe(xpBefore);
    const state = (await p.get("/hl")).body;
    expect(state).toMatchObject({ triesLeft: 0, todayBest: 1, best: 1, totalWins: HL_TRIES_PER_DAY });
    expect(state.practice).toEqual({ played: 2, todayBest: 6 });
    expect(state.runs).toHaveLength(HL_TRIES_PER_DAY);
    expect((await p.get("/me")).body.hlTriesLeft).toBe(0);
    const unlocked = await ctx.db.execute<{ n: number }>(sql`
      select count(*)::int as n from achievements_progress
      where user_id = ${p.userId} and achievement_key = 'hl_streak_5' and unlocked_at is not null
    `);
    expect(unlocked[0]!.n).toBe(0);
    const board = (await p.get("/leaderboard?board=hl_streak")).body.rows;
    expect(board.find((r: { me: boolean }) => r.me)).toMatchObject({ value: 1 });
  });

  it("en haut du pool, l'article gardé ne gagne pas à coup sûr : nouvelle paire si rien de plus vu", async () => {
    const p = await signUp(app);
    await p.post("/hl/start");
    // Article gardé : le plus vu du pool ; en face, un article moins vu.
    const [top] = await ctx.db.execute<{ id: string }>(sql`
      select c.id from cards c join wiki_summaries s on s.page_id = c.id and s.extract = ${MARK}
      where c.season = (select id from seasons where status = 'active') and c.rarity in ('SR', 'UR', 'L')
      order by c.views_12m desc limit 1
    `);
    const [lower] = await ctx.db.execute<{ id: string }>(sql`
      select c.id from cards c join wiki_summaries s on s.page_id = c.id and s.extract = ${MARK}
      where c.season = (select id from seasons where status = 'active') and c.rarity in ('SR', 'UR', 'L')
      order by c.views_12m desc offset 10 limit 1
    `);
    await ctx.db
      .update(schema.hlRuns)
      .set({ keptCardId: Number(top!.id), challengerCardId: Number(lower!.id) })
      .where(eq(schema.hlRuns.userId, p.userId));
    // Sens tiré « plus vu » (random → 0) : impossible face au plus vu du pool, donc paire entièrement nouvelle.
    const random = ctx.random;
    ctx.random = () => 0;
    try {
      const res = await p.post("/hl/answer", { step: 0, pick: "kept" });
      expect(res.body).toMatchObject({ correct: true, streak: 1, next: { renewed: true } });
      const [run] = await ctx.db.select().from(schema.hlRuns).where(eq(schema.hlRuns.userId, p.userId));
      expect(run!.keptCardId).not.toBe(Number(top!.id));
      expect(run!.pairRenewed).toBe(true);
    } finally {
      ctx.random = random;
    }
  });

  it("chaque réponse est journalisée : paire, vues, choix et temps de réponse", async () => {
    const p = await signUp(app);
    await p.post("/hl/start");
    const t0 = Date.now();
    ctx.now = () => new Date(t0 + 4_000);
    await p.post("/hl/answer", { step: 0, pick: await higherSide(p) });
    ctx.now = () => new Date(t0 + 4_000 + 1_600 + 3_000);
    await p.post("/hl/answer", { step: 1, pick: other(await higherSide(p)) });
    const [run] = await ctx.db.select().from(schema.hlRuns).where(eq(schema.hlRuns.userId, p.userId));
    const steps = await ctx.db
      .select()
      .from(schema.hlSteps)
      .where(eq(schema.hlSteps.runId, run!.id))
      .orderBy(schema.hlSteps.step);
    expect(steps.map((s) => [s.step, s.correct, s.timeout])).toEqual([
      [0, true, false],
      [1, false, false],
    ]);
    expect(steps[0]!.answerMs).toBeGreaterThanOrEqual(3_500);
    expect(steps[0]!.answerMs).toBeLessThan(6_000);
    expect(steps[1]!.answerMs).toBeGreaterThanOrEqual(2_500);
    expect(steps[1]!.answerMs).toBeLessThan(4_500);
    expect(steps[0]!.keptViews).toBeGreaterThan(0);
  });
});
