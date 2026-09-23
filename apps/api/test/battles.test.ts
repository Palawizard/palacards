import { eq, schema, sql } from "@palacards/db";
import { BATTLE_REWARDED_PER_PAIR_PER_DAY, ECONOMY, QUESTION_TIME_MS } from "@palacards/game";
import { afterAll, describe, expect, it } from "vitest";
import { forceFinish } from "../src/services/battles.js";
import { makeApp, signUp, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

async function deckOf(p: Client): Promise<number[]> {
  await p.post("/packs/open");
  const list = await p.get("/collection?limit=5&sort=atk");
  return list.body.items.map((c: { instanceId: number }) => c.instanceId);
}

async function playAll(p: Client, battleId: number, answer: (q: { choices: string[] }) => number, from = 1) {
  for (let r = from; r <= 5; r++) {
    const q = await p.post(`/battles/${battleId}/rounds/${r}/question`);
    if (q.status !== 200) return q;
    expect(q.body).not.toHaveProperty("answer");
    const a = await p.post(`/battles/${battleId}/rounds/${r}/answer`, { choice: answer(q.body) });
    expect(a.status).toBe(200);
  }
  return null;
}

describe("duels asynchrones", () => {
  it("défi, acceptation, mêmes questions, résultat, Elo et récompenses", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const created = await a.post("/battles", { opponent: b.username, mode: "async", deck: await deckOf(a) });
    expect(created.status).toBe(200);
    const id = created.body.id;
    expect((await a.post("/battles", { opponent: b.username, mode: "async", deck: await deckOf(a) })).body.error).toBe("battle_exists");
    expect((await b.get("/notifications")).body.items[0].type).toBe("battle_challenge");
    expect((await b.post(`/battles/${id}/accept`, { deck: await deckOf(b) })).status).toBe(200);

    // La même question est servie aux deux joueurs ; la bonne réponse n'est jamais envoyée avant.
    const qa = await a.post(`/battles/${id}/rounds/1/question`);
    const qb = await b.post(`/battles/${id}/rounds/1/question`);
    expect(qa.body.prompt).toBe(qb.body.prompt);
    expect(qa.body.choices).toEqual(qb.body.choices);
    expect(JSON.stringify(qa.body)).not.toContain("correct");
    // La carte adverse et les vues restent cachées jusqu'à la réponse (elles trahiraient « plus lu »).
    expect(qa.body.theirCard).toBeNull();
    expect(qa.body.yourCard).not.toHaveProperty("views12m");
    // Les manches se jouent dans l'ordre.
    expect((await a.post(`/battles/${id}/rounds/3/question`)).body.error).toBe("wrong_round");

    expect((await a.post(`/battles/${id}/rounds/1/answer`, { choice: 0 })).body.theirCard.title).toBeTruthy();
    expect((await a.post(`/battles/${id}/rounds/1/question`)).body.theirCard).not.toBeNull();
    expect((await a.post(`/battles/${id}/rounds/1/answer`, { choice: 1 })).body.error).toBe("already_answered");
    expect(await playAll(a, id, () => 0, 2)).toBeNull();
    // A a fini : pas encore de résultat.
    expect((await a.get(`/battles/${id}`)).body.status).toBe("active");
    await b.post(`/battles/${id}/rounds/1/answer`, { choice: 0 });
    for (let r = 2; r <= 5; r++) {
      const q = await b.post(`/battles/${id}/rounds/${r}/question`);
      if (q.status !== 200) break;
      await b.post(`/battles/${id}/rounds/${r}/answer`, { choice: 0 });
    }

    const detail = await a.get(`/battles/${id}`);
    expect(detail.body.status).toBe("finished");
    const [row] = await ctx.db.select().from(schema.battles).where(eq(schema.battles.id, id));
    expect(Math.max(row!.challengerScore, row!.opponentScore)).toBeGreaterThanOrEqual(row!.winnerId ? 1 : 0);
    expect(row!.challengerEloDelta! + row!.opponentEloDelta!).toBe(0);
    const rewards = await ctx.db.execute<{ delta: number }>(sql`select delta::int from ledger where reason = 'battle' and ref_id = ${String(id)} order by delta`);
    const expected = row!.winnerId ? [ECONOMY.battle.loss, ECONOMY.battle.win] : [20, 20];
    expect(rewards.map((r) => r.delta)).toEqual(expected);
    expect(detail.body.theirDeck).toHaveLength(5);
    expect(detail.body.rounds.length).toBeGreaterThanOrEqual(3);
  });

  it("mesure le temps côté serveur : une réponse hors délai compte comme absente", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const { body } = await a.post("/battles", { opponent: b.username, mode: "async", deck: await deckOf(a) });
    await b.post(`/battles/${body.id}/accept`, { deck: await deckOf(b) });
    await a.post(`/battles/${body.id}/rounds/1/question`);
    await ctx.db
      .update(schema.battleAnswers)
      .set({ servedAt: new Date(Date.now() - QUESTION_TIME_MS - 5_000) })
      .where(eq(schema.battleAnswers.battleId, body.id));
    const late = await a.post(`/battles/${body.id}/rounds/1/answer`, { choice: 0 });
    expect(late.body).toMatchObject({ yourChoice: null, correct: false, timeLeftMs: 0 });
  });

  it("plafonne les duels récompensés par paire et par jour", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const ids: number[] = [];
    for (let i = 0; i < BATTLE_REWARDED_PER_PAIR_PER_DAY + 1; i++) {
      const { body } = await a.post("/battles", { opponent: b.username, mode: "async", deck: await deckOf(a) });
      await b.post(`/battles/${body.id}/accept`, { deck: await deckOf(b) });
      await playAll(a, body.id, () => 0);
      await playAll(b, body.id, () => 0);
      ids.push(body.id);
    }
    const rows = await ctx.db.execute<{ ref_id: string }>(
      sql`select distinct ref_id from ledger where reason = 'battle' and user_id = ${a.userId}`,
    );
    expect(rows).toHaveLength(BATTLE_REWARDED_PER_PAIR_PER_DAY);
    expect(rows.map((r) => Number(r.ref_id))).not.toContain(ids.at(-1));
  });

  it("refus, droits et fin forcée", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const c = await signUp(app);
    const first = await a.post("/battles", { opponent: b.username, mode: "async", deck: await deckOf(a) });
    expect((await c.post(`/battles/${first.body.id}/accept`, { deck: await deckOf(c) })).status).toBe(403);
    expect((await c.get(`/battles/${first.body.id}`)).status).toBe(403);
    expect((await b.post(`/battles/${first.body.id}/refuse`)).status).toBe(200);

    const second = await a.post("/battles", { opponent: b.username, mode: "async", deck: await deckOf(a) });
    await b.post(`/battles/${second.body.id}/accept`, { deck: await deckOf(b) });
    await playAll(a, second.body.id, (q) => q.choices.length - 1);
    await forceFinish(ctx, second.body.id);
    const detail = await a.get(`/battles/${second.body.id}`);
    expect(detail.body.status).toBe("finished");
    // B n'a répondu à aucune manche : pas de PW pour lui.
    const paid = await ctx.db.execute<{ user_id: string }>(sql`select user_id from ledger where reason = 'battle' and ref_id = ${String(second.body.id)}`);
    expect(paid.map((r) => r.user_id)).toEqual([a.userId]);
  });
});
