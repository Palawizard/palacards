import { eq, schema, sql } from "@palacards/db";
import { BOSS_MIN_HP, BOSS_REWARDS, bossPhaseHp, parisDay } from "@palacards/game";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bossOfDay, finalizeBosses } from "../src/services/boss.js";
import { progressionIdle } from "../src/services/progression.js";
import { makeApp, signUp, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

const ledgerSum = async (userId: string, reason: string, kind = "pw") => {
  const [row] = await ctx.db.execute<{ n: string }>(
    sql`select coalesce(sum(delta), 0) as n from ledger where user_id = ${userId} and kind = ${kind} and reason = ${reason}`,
  );
  return Number(row?.n ?? 0);
};

const today = () => parisDay(ctx.now());

/** Ouvre des paquets, puis renvoie `n` articles jouables différents (sélecteur du boss). */
async function readyCards(p: Client, n = 5, packs = 2): Promise<number[]> {
  await ctx.db.update(schema.players).set({ bonusPacks: packs }).where(eq(schema.players.userId, p.userId));
  for (let i = 0; i < packs; i++) expect((await p.post("/packs/open")).status).toBe(200);
  await progressionIdle();
  const res = await p.get("/boss/cards");
  expect(res.status).toBe(200);
  const ready = (res.body.items as { instanceId: number; restDays: number }[]).filter((c) => c.restDays === 0);
  expect(ready.length).toBeGreaterThanOrEqual(n);
  return ready.slice(0, n).map((c) => c.instanceId);
}

/** Bonne réponse (ou mauvaise) lue en base : un index de choix, ou une année. */
async function answerOf(assaultId: number, idx: number, right: boolean) {
  const [hit] = await ctx.db.execute<{ question: { type: string; answer: number; choices: string[] } }>(
    sql`select question from boss_hits where assault_id = ${assaultId} and idx = ${idx}`,
  );
  const q = hit!.question;
  if (q.type === "year_input") return { idx, year: right ? q.answer : q.answer + 500 };
  return { idx, choice: right ? q.answer : (q.answer + 1) % q.choices.length };
}

async function playAssault(p: Client, right = true) {
  let state = (await p.get("/boss")).body;
  while (state.current && !state.current.finished) {
    const q = state.current.question;
    if (!q) {
      state = (await p.post(`/boss/assault/${state.current.id}/next`)).body;
      continue;
    }
    await p.post(`/boss/assault/${state.current.id}/answer`, await answerOf(state.current.id, q.idx, right));
    state = (await p.post(`/boss/assault/${state.current.id}/next`)).body;
  }
  return state;
}

describe("boss du jour : assauts", () => {
  it("frappe à chaque bonne réponse, refuse les cartes fatiguées et limite les assauts à deux par jour", async () => {
    const p = await signUp(app);
    const first = await readyCards(p, 10);
    const ids = first.slice(0, 5);
    const before = (await p.get("/boss")).body;
    expect(before.assaultsUsed).toBe(0);
    expect(before.rule.weakness).not.toBe(before.rule.resistance);
    const started = await p.post("/boss/assault", { instanceIds: ids });
    expect(started.status).toBe(200);
    expect(started.body.current.question).not.toBeNull();
    expect(started.body.current.question.choices.length).toBeGreaterThan(0);
    // La bonne réponse ne quitte jamais le serveur avant la réponse.
    expect(JSON.stringify(started.body.current.question)).not.toMatch(/"answer"/);
    expect((await p.post("/boss/assault", { instanceIds: ids })).status).toBe(409);
    const after = await playAssault(p, true);
    expect(after.current.finished).toBe(true);
    expect(after.current.hits).toHaveLength(5);
    expect(after.myDamage).toBeGreaterThan(0);
    expect(after.totalDamage).toBeGreaterThanOrEqual(after.myDamage);

    // Les cinq articles se reposent trois jours : refusés, grisés dans le sélecteur.
    const tired = await p.post("/boss/assault", { instanceIds: ids });
    expect(tired.status).toBe(409);
    expect(tired.body.error).toBe("card_tired");
    expect(tired.body.message).toMatch(/se repose encore 3 jours/);
    const picker = (await p.get("/boss/cards")).body.items as { instanceId: number; restDays: number }[];
    for (const id of ids) expect(picker.find((c) => c.instanceId === id)?.restDays).toBe(3);

    expect((await p.post("/boss/assault", { instanceIds: first.slice(5, 10) })).status).toBe(200);
    await playAssault(p, false);
    expect((await p.post("/boss/assault", { instanceIds: first.slice(5, 10) })).status).toBe(409);
    expect((await p.get("/me")).body.boss.assaultsLeft).toBe(0);
    await progressionIdle();
    const stats = await ctx.db.select().from(schema.playerStats).where(eq(schema.playerStats.userId, p.userId));
    expect(stats.find((s) => s.key === "boss_assaults")?.value).toBe(2);
  });

  it("refuse deux exemplaires du même article", async () => {
    const p = await signUp(app);
    const [id] = await readyCards(p, 4, 1);
    const [instance] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, id!));
    const copies = await ctx.db
      .insert(schema.cardInstances)
      .values(
        Array.from({ length: 4 }, () => ({
          ownerId: p.userId,
          cardId: instance!.cardId,
          season: instance!.season,
          rarity: instance!.rarity,
          atk: instance!.atk,
          def: instance!.def,
          source: "admin" as const,
        })),
      )
      .returning({ id: schema.cardInstances.id });
    const res = await p.post("/boss/assault", { instanceIds: [id!, ...copies.map((c) => c.id)] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("boss_same_article");
  });

  it("cache la carte pendant une question d'image", async () => {
    const p = await signUp(app);
    const started = (await p.post("/boss/assault", { instanceIds: await readyCards(p) })).body;
    const { id } = started.current;
    const idx = started.current.question.idx as number;
    await ctx.db.execute(
      sql`update boss_hits set question = question || '{"type": "image", "cardHidden": true}'::jsonb where assault_id = ${id} and idx = ${idx}`,
    );
    const q = (await p.get("/boss")).body.current.question;
    expect(q.cardHidden).toBe(true);
    expect(q.card).toMatchObject({ title: "", thumbUrl: null, pageUrl: null, cardId: 0, instanceId: null });
    await p.post(`/boss/assault/${id}/answer`, { idx, choice: 0 });
    const hit = (await p.get("/boss")).body.current.hits[0];
    expect(hit.card.title).not.toBe("");
  });

  it("pose une année à taper, sans redite pour le joueur, et paie selon l'écart", async () => {
    const p = await signUp(app);
    const ids = await readyCards(p);
    const [first] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, ids[0]!));
    // Un résumé avec deux années : l'une a déjà été posée à ce joueur, c'est donc l'autre.
    const extract =
      "Cet article de test parle d'une construction achevée en 1889 à Paris. Elle a été rénovée de fond en comble en 1920 par la ville.";
    await ctx.db
      .insert(schema.wikiSummaries)
      .values({ pageId: first!.cardId, extract, status: "ok" })
      .onConflictDoUpdate({ target: schema.wikiSummaries.pageId, set: { extract, description: null, status: "ok" } });
    await ctx.db
      .insert(schema.bossQuestionHistory)
      .values({ userId: p.userId, cardId: first!.cardId, type: "year_input", key: "extract:1889" });
    const started = (await p.post("/boss/assault", { instanceIds: ids })).body;
    const q = started.current.question;
    expect(q.idx).toBe(0);
    expect(q.input).toBe("year");
    expect(q.durationMs).toBe(18_000);
    expect(q.prompt).toContain("▢▢▢▢");
    expect(q.prompt).toContain("rénovée");
    // Mauvais type de réponse : refusé.
    expect((await p.post(`/boss/assault/${started.current.id}/answer`, { idx: 0, choice: 0 })).status).toBe(400);
    const res = await p.post(`/boss/assault/${started.current.id}/answer`, { idx: 0, year: 1918 });
    const hit = res.body.current.hits[0];
    expect(hit).toMatchObject({ type: "year_input", hit: "hit", correctYear: 1920, guessYear: 1918 });
    expect(hit.damage).toBe(Math.max(1, Math.round((40 + hit.card.atk / 100) * hit.mult)));
    const history = await ctx.db
      .select()
      .from(schema.bossQuestionHistory)
      .where(eq(schema.bossQuestionHistory.userId, p.userId));
    expect(history.map((h) => `${h.cardId}:${h.key}`)).toEqual(
      expect.arrayContaining([`${first!.cardId}:extract:1889`, `${first!.cardId}:extract:1920`]),
    );
  });
});

describe("boss du jour : phases", () => {
  it("fait tomber une phase et enchaîne aussitôt sur la suivante, plus solide", async () => {
    const p = await signUp(app);
    const ids = await readyCards(p);
    const boss = await bossOfDay(ctx);
    // Le boss à 1 PV de la fin de sa phase en cours : le premier coup juste la fait tomber.
    const state0 = (await p.get("/boss")).body;
    await ctx.db
      .update(schema.bossDays)
      .set({ damage: boss.damage + state0.hp - 1 })
      .where(eq(schema.bossDays.day, boss.day));
    const phaseBefore = state0.phase as number;
    await p.post("/boss/assault", { instanceIds: ids });
    const end = await playAssault(p, true);
    expect(end.phase).toBe(phaseBefore + 1);
    expect(end.maxHp).toBe(bossPhaseHp(boss.maxHp, phaseBefore + 1));
    const fallen = end.phases.find((x: { phase: number }) => x.phase === phaseBefore);
    expect(fallen.fallenAt).not.toBeNull();
    expect(fallen.fallenBy).toBe(p.username);
    expect(end.phases.at(-1)).toMatchObject({ phase: phaseBefore + 1, fallenAt: null });
    // Rien n'est versé avant minuit, mais le gain acquis s'affiche.
    expect(await ledgerSum(p.userId, "boss")).toBe(0);
    if (end.myDamage >= BOSS_REWARDS.phases.length) expect(end.earned.mvp).toBeDefined();
    expect((await p.get("/me")).body.boss.phase).toBe(phaseBefore + 1);
  });

  it("cale les PV de la phase 1 sur les dégâts des derniers jours (ancien format à 60 %)", async () => {
    const players = await Promise.all(Array.from({ length: 3 }, () => signUp(app)));
    await ctx.db.insert(schema.bossDays).values([
      { day: "2098-12-30", cardId: 1, season: 1, maxHp: 4_000, hp: 4_000, version: 1 },
      { day: "2098-12-31", cardId: 1, season: 1, maxHp: 4_000, hp: 4_000, version: 2 },
    ]);
    await ctx.db
      .insert(schema.bossAssaults)
      .values([
        ...players.map((p) => ({ day: "2098-12-30", userId: p.userId, number: 1, damage: 10_000 })),
        ...players.map((p) => ({ day: "2098-12-31", userId: p.userId, number: 1, damage: 6_000 })),
      ]);
    const boss = await bossOfDay(ctx, "2099-01-01");
    // (30 000 × 0,6 + 18 000) ÷ 2 = 18 000 par jour → 35 % = 6 300 → 6 500.
    expect(boss.maxHp).toBe(6_500);
    expect(boss).toMatchObject({ version: 2, phase: 1, damage: 0, hp: 6_500 });
    expect(boss.weakness).not.toBeNull();
    // Sans historique : le minimum.
    expect((await bossOfDay(ctx, "2099-06-01")).maxHp).toBe(BOSS_MIN_HP);
  });
});

describe("boss du jour : clôture de minuit", () => {
  async function pastDay(day: string, values: { maxHp: number; damage: number; version?: number }) {
    const [any] = await ctx.db
      .select({ cardId: schema.cards.id, season: schema.cards.season })
      .from(schema.cards)
      .limit(1);
    await ctx.db.delete(schema.bossDays).where(eq(schema.bossDays.day, day));
    await ctx.db.insert(schema.bossDays).values({
      day,
      cardId: any!.cardId,
      season: any!.season,
      hp: 1,
      version: 2,
      ...values,
    });
  }

  it("paie les phases tombées au-delà du seuil, console les autres, une seule fois", async () => {
    const top = await signUp(app);
    const small = await signUp(app);
    const day = "2001-02-03";
    // Deux phases tombées (4 000 + 5 600), la troisième entamée.
    await pastDay(day, { maxHp: 4_000, damage: 10_000 });
    await ctx.db.insert(schema.bossPhases).values([
      { day, phase: 1, maxHp: 4_000, fallenAt: new Date("2001-02-03T10:00:00Z"), fallenBy: small.userId },
      { day, phase: 2, maxHp: 5_600, fallenAt: new Date("2001-02-03T18:00:00Z"), fallenBy: top.userId },
    ]);
    await ctx.db.insert(schema.bossAssaults).values([
      { day, userId: top.userId, number: 1, damage: 900 },
      { day, userId: small.userId, number: 1, damage: 150 },
    ]);
    await finalizeBosses(ctx);
    await finalizeBosses(ctx);
    await progressionIdle();
    expect(await ledgerSum(top.userId, "boss")).toBe(100);
    expect(await ledgerSum(top.userId, "boss", "bonus_pack")).toBe(2 + BOSS_REWARDS.mvpPacks);
    // Sous le seuil de 200 dégâts : consolation seulement.
    expect(await ledgerSum(small.userId, "boss")).toBe(BOSS_REWARDS.consolationPw);
    expect(await ledgerSum(small.userId, "boss", "bonus_pack")).toBe(0);
    const types = await ctx.db.execute<{ type: string }>(
      sql`select type from notifications where user_id = ${top.userId} order by id`,
    );
    expect(types.map((t) => t.type)).toEqual(expect.arrayContaining(["boss_phase", "boss_mvp"]));
    const stats = await ctx.db.select().from(schema.playerStats).where(eq(schema.playerStats.userId, top.userId));
    expect(stats.find((x) => x.key === "boss_phases")?.value).toBe(2);
    expect(stats.find((x) => x.key === "boss_kills")?.value).toBe(1);
    expect(stats.find((x) => x.key === "boss_last_hit")?.value).toBe(1);
    expect(stats.find((x) => x.key === "boss_mvp")?.value).toBe(1);
  });

  it("verse la consolation si aucune phase n'est tombée", async () => {
    const p = await signUp(app);
    const day = "2001-02-04";
    await pastDay(day, { maxHp: 4_000, damage: 3_000 });
    await ctx.db.insert(schema.bossAssaults).values({ day, userId: p.userId, number: 1, damage: 400 });
    await finalizeBosses(ctx);
    expect(await ledgerSum(p.userId, "boss")).toBe(BOSS_REWARDS.consolationPw);
    // Le meilleur assaillant a toujours son paquet.
    expect(await ledgerSum(p.userId, "boss", "bonus_pack")).toBe(BOSS_REWARDS.mvpPacks);
  });
});

describe("boss du jour : jour de la mise à jour", () => {
  it("convertit l'ancien boss en phase 1 (tombé : phase 2), sans rien repayer", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const [any] = await ctx.db
      .select({ cardId: schema.cards.id, season: schema.cards.season })
      .from(schema.cards)
      .limit(1);
    const day = "2001-05-05";
    await ctx.db.delete(schema.bossDays).where(eq(schema.bossDays.day, day));
    // Ancien format : tombé, A payé à la chute (100 PW, 2 paquets), B jamais (assaut abandonné).
    await ctx.db.insert(schema.bossDays).values({
      day,
      cardId: any!.cardId,
      season: any!.season,
      maxHp: 4_000,
      hp: 0,
      killedAt: new Date("2001-05-05T00:30:00Z"),
      killedBy: a.userId,
    });
    await ctx.db.insert(schema.bossAssaults).values([
      { day, userId: a.userId, number: 1, damage: 3_000 },
      { day, userId: b.userId, number: 1, damage: 1_000 },
    ]);
    await ctx.db.insert(schema.bossRewards).values({ day, userId: a.userId });
    // La migration de données, jouée dans une transaction annulée ensuite (elle touche tous les boss).
    const migration = readFileSync(
      new URL("../../../packages/db/migrations/0036_boss_phases_data.sql", import.meta.url),
      "utf8",
    );
    const migrated = await ctx.db
      .transaction(async (tx) => {
        for (const stmt of migration.split("--> statement-breakpoint")) await tx.execute(sql.raw(stmt));
        const [row] = await tx.select().from(schema.bossDays).where(eq(schema.bossDays.day, day));
        const phases = await tx.select().from(schema.bossPhases).where(eq(schema.bossPhases.day, day));
        throw Object.assign(new Error("rollback"), { row, phases });
      })
      .catch((e: { row: unknown; phases: unknown[] }) => e);
    expect(migrated.row).toMatchObject({ phase: 2, damage: 4_000, hp: 5_600 });
    expect(migrated.phases).toHaveLength(1);
    // Même état, posé à la main (la transaction a été annulée), puis clôture de minuit.
    await ctx.db
      .update(schema.bossDays)
      .set({ phase: 2, damage: 4_000, hp: 5_600 })
      .where(eq(schema.bossDays.day, day));
    await finalizeBosses(ctx);
    // A : déjà payé pour deux phases, une seule tombée → rien de plus que le paquet du meilleur assaillant.
    expect(await ledgerSum(a.userId, "boss")).toBe(0);
    expect(await ledgerSum(a.userId, "boss", "bonus_pack")).toBe(BOSS_REWARDS.mvpPacks);
    // B : la phase 1.
    expect(await ledgerSum(b.userId, "boss")).toBe(BOSS_REWARDS.phases[0].pw);
    expect(await ledgerSum(b.userId, "boss", "bonus_pack")).toBe(BOSS_REWARDS.phases[0].packs);
  });

  it("donne sa règle du jour à un boss créé avant la mise à jour", async () => {
    const [any] = await ctx.db
      .select({ cardId: schema.cards.id, season: schema.cards.season })
      .from(schema.cards)
      .limit(1);
    await ctx.db
      .insert(schema.bossDays)
      .values({ day: "2099-02-02", cardId: any!.cardId, season: any!.season, maxHp: 4_000, hp: 4_000 });
    const boss = await bossOfDay(ctx, "2099-02-02");
    expect(boss.weakness).not.toBeNull();
    expect(boss.resistance).not.toBe(boss.weakness);
    expect(today()).toBeTruthy();
  });
});
