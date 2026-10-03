import { and, eq, schema, sql } from "@palacards/db";
import {
  AFK_FORFEIT,
  BATTLE_HP,
  BATTLE_REWARDED_PER_PAIR_PER_DAY,
  ECONOMY,
  ELO_START,
  QUESTION_TIME_MS,
  TOTAL_TURNS,
  type Question,
} from "@palacards/game";
import type { BattleStateDTO } from "@palacards/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { battleEngine, runDue } from "../src/services/battles.js";
import { makeApp, signUp, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
let online: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  // Duels en direct : les deux joueurs sont « connectés » (pas de vraie socket dans ces tests).
  online = vi.spyOn(ctx.rt, "isOnline").mockReturnValue(true);
});
afterAll(async () => {
  online.mockRestore();
  await app.close();
});

async function deckOf(p: Client): Promise<number[]> {
  await p.post("/packs/open");
  const list = await p.get("/collection?limit=5&sort=atk");
  return list.body.items.map((c: { instanceId: number }) => c.instanceId);
}

/** Défi accepté et écran du duel ouvert par les deux : premier tour. */
async function startDuel(a?: Client, b?: Client) {
  a ??= await signUp(app);
  b ??= await signUp(app);
  const created = await a.post("/battles", { opponent: b.username, deck: await deckOf(a) });
  expect(created.status).toBe(200);
  const id: number = created.body.id;
  expect((await b.post(`/battles/${id}/accept`, { deck: await deckOf(b) })).status).toBe(200);
  expect((await a.get(`/battles/${id}`)).body.phase).toBe("lobby");
  await battleEngine.join(ctx, a.userId, id);
  await battleEngine.join(ctx, b.userId, id);
  return { a, b, id };
}

const stateOf = async (p: Client, id: number) => (await p.get(`/battles/${id}`)).body as BattleStateDTO;

/** Fait sonner l'échéance de la phase en cours (chrono écoulé). */
async function expire(id: number) {
  const past = new Date(Date.now() - QUESTION_TIME_MS - 5_000);
  await ctx.db.update(schema.battles).set({ phaseEndsAt: past }).where(eq(schema.battles.id, id));
  await ctx.db
    .update(schema.battleTurns)
    .set({ servedAt: past })
    .where(and(eq(schema.battleTurns.battleId, id), sql`served_at is not null`));
  await runDue(ctx, id);
}

async function currentQuestion(id: number): Promise<Question> {
  const [b] = await ctx.db.select().from(schema.battles).where(eq(schema.battles.id, id));
  const [t] = await ctx.db
    .select()
    .from(schema.battleTurns)
    .where(and(eq(schema.battleTurns.battleId, id), eq(schema.battleTurns.turn, b!.turn)));
  return t!.question as Question;
}

/** Joue un tour complet : attaque, bouclier, réponse (juste ou fausse), fin de l'affichage. */
async function playTurn(players: Client[], id: number, correct: boolean) {
  const s = await stateOf(players[0]!, id);
  const attacker = players.find((p) => p.userId === s.attackerId)!;
  const defender = players.find((p) => p.userId !== s.attackerId)!;
  const mine = (await stateOf(attacker, id)).myHand.find((c) => !c.attacked)!;
  expect((await attacker.post(`/battles/${id}/attack`, { slot: mine.slot })).status).toBe(200);
  const shield = (await stateOf(defender, id)).myHand.find((c) => !c.shielded)!;
  expect((await defender.post(`/battles/${id}/shield`, { slot: shield.slot })).status).toBe(200);
  const q = await currentQuestion(id);
  const choice = correct ? q.answer : (q.answer + 1) % q.choices.length;
  const res = await defender.post(`/battles/${id}/answer`, { choice });
  expect(res.status).toBe(200);
  await expire(id); // fin de l'affichage du résultat
  return { attacker, defender, state: res.body as BattleStateDTO };
}

describe("duel Attaque / Bouclier", () => {
  it("déroulé complet : cartes cachées, question, dégâts, fin, Elo et récompenses", async () => {
    const { a, b, id } = await startDuel();
    expect((await a.post("/battles", { opponent: b.username, deck: await deckOf(a) })).body.error).toBe(
      "battle_exists",
    );
    let s = await stateOf(a, id);
    expect(s).toMatchObject({ status: "active", phase: "attack", turn: 1, maxHp: BATTLE_HP });
    expect(s.you.hp).toBe(BATTLE_HP);
    // Deck adverse : rareté et stats visibles, titres cachés.
    expect(s.theirHand).toHaveLength(5);
    expect(s.theirHand.every((c) => c.card === null)).toBe(true);
    expect(s.myHand.every((c) => c.card?.title)).toBe(true);

    const attacker = s.attackerId === a.userId ? a : b;
    const defender = attacker === a ? b : a;
    // Hors de son tour : refusé.
    expect((await defender.post(`/battles/${id}/attack`, { slot: 1 })).body.error).toBe("not_your_turn");
    // Pas de légendaire : le catalogue de test n'en compte que deux, aux titres numérotés qui se recoupent
    // (« n° 1 » dans « n° 1X ») ; sa question n'aurait pas assez de leurres pour quatre choix.
    const slot = (await stateOf(attacker, id)).myHand.find((c) => c.rarity !== "L")!.slot;
    expect((await attacker.post(`/battles/${id}/attack`, { slot })).status).toBe(200);
    s = await stateOf(defender, id);
    expect(s.phase).toBe("shield");
    // Carte attaquante face cachée pour le défenseur : rareté et dégâts seulement.
    expect(s.current?.attack.slot).toBe(slot);
    expect(s.current?.attack.card).toBeNull();
    expect(s.current?.attack.damage).toBeGreaterThan(0);
    expect((await attacker.post(`/battles/${id}/shield`, { slot: 1 })).body.error).toBe("not_your_turn");
    expect((await defender.post(`/battles/${id}/shield`, { slot: 3 })).status).toBe(200);

    s = await stateOf(defender, id);
    expect(s.phase).toBe("question");
    expect(s.current?.question?.choices).toHaveLength(4);
    expect(s.current?.outcome).toBeNull();
    // La bonne réponse ne quitte jamais le serveur avant la réponse.
    expect(JSON.stringify(s)).not.toContain("correctIndex");
    expect(JSON.stringify(await stateOf(attacker, id))).not.toContain("correctIndex");
    expect((await attacker.post(`/battles/${id}/answer`, { choice: 0 })).body.error).toBe("not_your_turn");

    const q = await currentQuestion(id);
    const wrong = (q.answer + 1) % 4;
    s = (await defender.post(`/battles/${id}/answer`, { choice: wrong })).body;
    expect(s.phase).toBe("reveal");
    expect(s.current?.outcome).toMatchObject({ choice: wrong, correctIndex: q.answer, correct: false, parry: "none" });
    const dmg = s.current!.outcome!.damage;
    expect(dmg).toBeGreaterThan(0);
    expect(s.you.hp).toBe(BATTLE_HP - dmg);
    expect((await defender.post(`/battles/${id}/answer`, { choice: 0 })).body.error).toBe("wrong_phase");

    // Tour suivant : l'autre joueur attaque ; une carte ne peut attaquer qu'une fois.
    await expire(id);
    s = await stateOf(a, id);
    expect(s).toMatchObject({ phase: "attack", turn: 2, attackerId: defender.userId });
    expect(s.turns).toHaveLength(1);
    // Une parade parfaite renvoie des dégâts : selon les cartes tirées, l'attaquant du tour 1 pourrait
    // tomber dès ce tour. PV remis au maximum pour que le duel continue.
    await ctx.db
      .update(schema.battles)
      .set({ challengerHp: BATTLE_HP, opponentHp: BATTLE_HP })
      .where(eq(schema.battles.id, id));
    await playTurn([a, b], id, true);
    s = await stateOf(a, id);
    expect(s.turns[1]?.outcome?.correct).toBe(true);
    expect(s.turns[1]?.outcome?.damage).toBe(0);
    expect((await attacker.post(`/battles/${id}/attack`, { slot })).body.error).toBe("invalid_slot");

    // Le reste du duel : mauvaises réponses jusqu'à la fin.
    for (let t = 3; t <= TOTAL_TURNS; t++) {
      if ((await stateOf(a, id)).status !== "active") break;
      await playTurn([a, b], id, false);
    }
    s = await stateOf(a, id);
    expect(s.status).toBe("finished");
    expect(s.result).not.toBeNull();
    // Fin du duel : toutes les cartes révélées.
    expect(s.theirHand.every((c) => c.card?.title)).toBe(true);
    const [row] = await ctx.db.select().from(schema.battles).where(eq(schema.battles.id, id));
    expect(row!.challengerEloDelta! + row!.opponentEloDelta!).toBe(0);
    const rewards = await ctx.db.execute<{ delta: number }>(
      sql`select delta::int from ledger where reason = 'battle' and ref_id = ${String(id)} order by delta`,
    );
    const expected = row!.winnerId ? [ECONOMY.battle.loss, ECONOMY.battle.win] : [20, 20];
    expect(rewards.map((r) => r.delta)).toEqual(expected);
    expect(s.result!.reward).toBe(
      s.result!.outcome === "win" ? ECONOMY.battle.win : s.result!.outcome === "loss" ? ECONOMY.battle.loss : 20,
    );
    const list = await b.get("/battles");
    expect(list.body.find((x: { id: number }) => x.id === id)).toMatchObject({ status: "finished" });
  });

  it("bonne réponse rapide : parade parfaite, une part des dégâts revient à l'attaquant", async () => {
    const { a, b, id } = await startDuel();
    const { attacker, state } = await playTurn([a, b], id, true);
    expect(state.turns.at(-1) ?? state.current).toBeTruthy();
    const s = await stateOf(attacker, id);
    const outcome = s.turns[0]!.outcome!;
    expect(outcome).toMatchObject({ correct: true, damage: 0, parry: "perfect" });
    expect(outcome.reflected).toBeGreaterThan(0);
    expect(s.you.hp).toBe(BATTLE_HP - outcome.reflected);
  });

  it("chrono écoulé : actions automatiques, puis abandon après 3 actions manquées", async () => {
    const { a, b, id } = await startDuel();
    const first = (await stateOf(a, id)).attackerId!;
    const afk = first === a.userId ? a : b;
    const active = afk === a ? b : a;
    // Tour 1 : l'attaquant ne joue pas, carte choisie au hasard.
    await expire(id);
    let s = await stateOf(active, id);
    expect(s.phase).toBe("shield");
    expect(s.current?.attackAuto).toBe(true);
    await active.post(`/battles/${id}/shield`, { slot: 1 });
    await active.post(`/battles/${id}/answer`, { choice: 0 });
    await expire(id);
    // Tour 2 : l'absent défend sans jouer (bouclier automatique, pas de réponse).
    s = await stateOf(active, id);
    await active.post(`/battles/${id}/attack`, { slot: s.myHand.find((c) => !c.attacked)!.slot });
    await expire(id); // bouclier automatique
    s = await stateOf(active, id);
    expect(s.phase).toBe("question");
    expect(s.current?.shieldAuto).toBe(true);
    await expire(id); // pas de réponse
    s = await stateOf(active, id);
    expect(s.current?.outcome).toMatchObject({ choice: null, correct: false });
    expect(s.them.idle).toBe(AFK_FORFEIT);
    await expire(id); // fin de l'affichage : abandon de l'absent
    s = await stateOf(active, id);
    expect(s).toMatchObject({ status: "finished", result: { outcome: "win", forfeitBy: "them" } });
    // L'absent n'a rien joué : pas d'Elo ni de PW pour lui.
    const paid = await ctx.db.execute<{ user_id: string }>(
      sql`select user_id from ledger where reason = 'battle' and ref_id = ${String(id)}`,
    );
    expect(paid.map((r) => r.user_id)).toEqual([active.userId]);
    const [row] = await ctx.db.select().from(schema.battles).where(eq(schema.battles.id, id));
    expect(row).toMatchObject({ challengerEloDelta: 0, opponentEloDelta: 0 });
  });

  it("« Quelle image ? » : la carte attaquante reste face cachée jusqu'à la réponse", async () => {
    const { a, b, id } = await startDuel();
    const s0 = await stateOf(a, id);
    const attacker = s0.attackerId === a.userId ? a : b;
    const defender = attacker === a ? b : a;
    await attacker.post(`/battles/${id}/attack`, { slot: 1 });
    await defender.post(`/battles/${id}/shield`, { slot: 1 });
    // Question d'image posée à la place de celle générée (pas de Wikipédia dans les tests).
    const image: Question = {
      type: "image",
      prompt: "Quelle image illustre « X » ?",
      choices: [
        "https://upload.wikimedia.org/1.jpg",
        "https://upload.wikimedia.org/2.jpg",
        "https://upload.wikimedia.org/3.jpg",
        "https://upload.wikimedia.org/4.jpg",
      ],
      answer: 2,
      titleHidden: false,
    };
    await ctx.db.update(schema.battleTurns).set({ question: image }).where(eq(schema.battleTurns.battleId, id));
    let s = await stateOf(defender, id);
    expect(s.current?.question?.type).toBe("image");
    expect(s.current?.attack.card).toBeNull();
    expect(s.theirHand.find((c) => c.slot === 1)?.card).toBeNull();
    s = (await defender.post(`/battles/${id}/answer`, { choice: 2 })).body;
    expect(s.current?.attack.card?.title).toBeTruthy();
  });

  it("coupe le catalogue pendant que le défenseur répond", async () => {
    const { a, b, id } = await startDuel();
    const s = await stateOf(a, id);
    const attacker = s.attackerId === a.userId ? a : b;
    const defender = attacker === a ? b : a;
    await attacker.post(`/battles/${id}/attack`, { slot: 1 });
    await defender.post(`/battles/${id}/shield`, { slot: 1 });
    expect((await defender.get("/cards?q=carte")).body.error).toBe("duel_question");
    expect((await attacker.get("/cards?q=carte")).status).toBe(200);
    await defender.post(`/battles/${id}/answer`, { choice: 0 });
    expect((await defender.get("/cards?q=carte")).status).toBe(200);
  });

  it("une réponse hors délai compte comme absente", async () => {
    const { a, b, id } = await startDuel();
    const s = await stateOf(a, id);
    const attacker = s.attackerId === a.userId ? a : b;
    const defender = attacker === a ? b : a;
    await attacker.post(`/battles/${id}/attack`, { slot: 1 });
    await defender.post(`/battles/${id}/shield`, { slot: 1 });
    await ctx.db
      .update(schema.battleTurns)
      .set({ servedAt: new Date(Date.now() - QUESTION_TIME_MS - 5_000) })
      .where(eq(schema.battleTurns.battleId, id));
    const q = await currentQuestion(id);
    const late = (await defender.post(`/battles/${id}/answer`, { choice: q.answer })).body as BattleStateDTO;
    expect(late.current?.outcome).toMatchObject({ choice: null, correct: false });
  });

  it("abandon volontaire, salle d'attente expirée, refus et droits", async () => {
    const { a, b, id } = await startDuel();
    const c = await signUp(app);
    expect((await c.get(`/battles/${id}`)).status).toBe(403);
    expect((await c.post(`/battles/${id}/forfeit`)).status).toBe(403);
    // A abandonne sans avoir joué : B gagne, mais rien n'est noté (A n'a rien joué).
    const s = (await a.post(`/battles/${id}/forfeit`)).body as BattleStateDTO;
    expect(s).toMatchObject({ status: "finished", result: { outcome: "loss", forfeitBy: "you" } });
    expect((await stateOf(b, id)).result).toMatchObject({ outcome: "win", forfeitBy: "them" });

    // Accepté mais personne n'ouvre l'écran : annulé à l'échéance.
    const second = await a.post("/battles", { opponent: b.username, deck: await deckOf(a) });
    await b.post(`/battles/${second.body.id}/accept`, { deck: await deckOf(b) });
    await expire(second.body.id);
    expect((await stateOf(a, second.body.id)).status).toBe("cancelled");

    const third = await a.post("/battles", { opponent: b.username, deck: await deckOf(a) });
    expect((await c.post(`/battles/${third.body.id}/accept`, { deck: await deckOf(c) })).status).toBe(403);
    expect((await b.post(`/battles/${third.body.id}/refuse`)).status).toBe(200);
    expect((await stateOf(a, third.body.id)).status).toBe("declined");
  });

  it("refuse l'acceptation si le challenger n'est pas connecté", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const { body } = await a.post("/battles", { opponent: b.username, deck: await deckOf(a) });
    online.mockReturnValueOnce(false);
    expect((await b.post(`/battles/${body.id}/accept`, { deck: await deckOf(b) })).body.error).toBe("opponent_offline");
  });

  it("plafonne les duels récompensés par paire et par jour", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const ids: number[] = [];
    for (let i = 0; i < BATTLE_REWARDED_PER_PAIR_PER_DAY + 1; i++) {
      const { id } = await startDuel(a, b);
      // Les deux jouent un tour, puis B abandonne.
      await playTurn([a, b], id, false);
      await b.post(`/battles/${id}/forfeit`);
      ids.push(id);
    }
    const rows = await ctx.db.execute<{ ref_id: string }>(
      sql`select distinct ref_id from ledger where reason = 'battle' and user_id = ${a.userId}`,
    );
    expect(rows).toHaveLength(BATTLE_REWARDED_PER_PAIR_PER_DAY);
    expect(rows.map((r) => Number(r.ref_id))).not.toContain(ids.at(-1));
    const [last] = await ctx.db
      .select()
      .from(schema.battles)
      .where(eq(schema.battles.id, ids.at(-1)!));
    expect(last).toMatchObject({ status: "finished", challengerEloDelta: 0, opponentEloDelta: 0 });
    const eloOf = async (p: Client) =>
      (await ctx.db.select().from(schema.players).where(eq(schema.players.userId, p.userId)))[0]!.elo;
    expect((await eloOf(a)) + (await eloOf(b))).toBe(2 * ELO_START);
  });
});
