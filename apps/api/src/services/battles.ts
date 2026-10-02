import { and, asc, desc, eq, inArray, or, schema, sql } from "@palacards/db";
import {
  AFK_FORFEIT,
  ANSWER_GRACE_MS,
  ATTACK_TIME_MS,
  attackDamage,
  attackerOfTurn,
  BATTLE_HP,
  BATTLE_REWARDED_PER_PAIR_PER_DAY,
  battleOver,
  battleRated,
  battleResult,
  battleReward,
  cardHiddenUntilAnswer,
  CHALLENGE_TTL_MS,
  DECK_SIZE,
  effectiveStats,
  eloUpdate,
  LOBBY_TIMEOUT_MS,
  QUESTION_TIME_MS,
  resolveHit,
  REVEAL_TIME_MS,
  SHIELD_TIME_MS,
  shieldPercent,
  TOTAL_TURNS,
  type BattlePhase,
  type Question,
  type QuestionType,
  type Rarity,
} from "@palacards/game";
import type { BattleCardView, BattleStateDTO, BattleTurnView, CardDTO } from "@palacards/shared";
import { randomBytes } from "node:crypto";
import type { Ctx } from "../context.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { afterCommit, Effects } from "./notifications.js";
import { bumpObjective } from "./guilds.js";
import { lockPlayers, movePw, pushWallet, type DbOrTx, type Player } from "./players.js";
import { findUserByName } from "./profiles.js";
import { QUESTION_PREP_MS, quizQuestion, withTimeout } from "./quiz.js";
import { articleUrl } from "./wiki.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type Battle = typeof schema.battles.$inferSelect;
type Turn = typeof schema.battleTurns.$inferSelect;
type DeckRow = typeof schema.battleDecks.$inferSelect;

const b = schema.battles;
const bt = schema.battleTurns;

/** Compte à rebours affiché avant la première attaque (ajouté au chrono du tour 1). */
const START_DELAY_MS = 3_000;

// ---------------------------------------------------------------------------
// Lecture de l'état en base
// ---------------------------------------------------------------------------

async function lockBattle(tx: Tx, battleId: number): Promise<Battle> {
  const [row] = await tx.select().from(b).where(eq(b.id, battleId)).for("update");
  if (!row) throw notFound("Ce duel n'existe pas.");
  return row;
}

async function decks(db: DbOrTx, battleId: number): Promise<DeckRow[]> {
  return db
    .select()
    .from(schema.battleDecks)
    .where(eq(schema.battleDecks.battleId, battleId))
    .orderBy(asc(schema.battleDecks.slot));
}

async function turnsOf(db: DbOrTx, battleId: number): Promise<Turn[]> {
  return db.select().from(bt).where(eq(bt.battleId, battleId)).orderBy(asc(bt.turn));
}

const otherOf = (battle: Battle, userId: string) =>
  battle.challengerId === userId ? battle.opponentId : battle.challengerId;

function requireSide(battle: Battle, userId: string) {
  if (battle.challengerId !== userId && battle.opponentId !== userId) throw forbidden("Ce duel ne te concerne pas.");
}

/** Attaquant du tour `turn` (le premier attaquant aux tours impairs). */
function attackerOf(battle: Battle, turn: number): string {
  const first = battle.firstAttackerId ?? battle.challengerId;
  return attackerOfTurn(turn, first, otherOf(battle, first));
}

const hpOf = (battle: Battle, userId: string) =>
  (userId === battle.challengerId ? battle.challengerHp : battle.opponentHp) ?? BATTLE_HP;

const deckOf = (all: DeckRow[], userId: string, slot: number) =>
  all.find((d) => d.userId === userId && d.slot === slot)!;

const pick = <T>(ctx: Ctx, items: T[]): T => items[ctx.random(items.length)]!;

// ---------------------------------------------------------------------------
// Défis
// ---------------------------------------------------------------------------

/** Vérifie un deck (5 exemplaires distincts possédés) et fige ses stats. */
async function snapshotDeck(tx: Tx, battleId: number, userId: string, instanceIds: number[]) {
  if (instanceIds.length !== DECK_SIZE || new Set(instanceIds).size !== DECK_SIZE) {
    throw badRequest("invalid_deck", `Choisis ${DECK_SIZE} cartes différentes.`);
  }
  const rows = await tx
    .select()
    .from(schema.cardInstances)
    .where(and(inArray(schema.cardInstances.id, instanceIds), eq(schema.cardInstances.ownerId, userId)));
  if (rows.length !== DECK_SIZE) throw notFound("Une carte du deck n'est plus dans ta collection.");
  const byId = new Map(rows.map((r) => [r.id, r]));
  await tx.insert(schema.battleDecks).values(
    instanceIds.map((id, i) => {
      const r = byId.get(id)!;
      const stats = effectiveStats(r.atk, r.def, r.level);
      return {
        battleId,
        userId,
        slot: i + 1,
        instanceId: id,
        cardId: r.cardId,
        season: r.season,
        rarity: r.rarity,
        atk: stats.atk,
        def: stats.def,
      };
    }),
  );
}

async function displayName(db: DbOrTx, userId: string): Promise<string> {
  const [me] = await db
    .select({ name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})` })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return me?.name ?? "?";
}

export async function challenge(ctx: Ctx, challengerId: string, input: { opponent: string; deck: number[] }) {
  const opponent = await findUserByName(ctx.db, input.opponent);
  if (opponent.id === challengerId) throw badRequest("self", "Tu ne peux pas te défier toi-même.");
  const fx = new Effects();
  const battle = await ctx.db.transaction(async (tx) => {
    await lockPlayers(tx, [challengerId, opponent.id]);
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(b)
      .where(
        and(
          inArray(b.status, ["pending", "active"]),
          or(
            and(eq(b.challengerId, challengerId), eq(b.opponentId, opponent.id)),
            and(eq(b.challengerId, opponent.id), eq(b.opponentId, challengerId)),
          ),
        ),
      );
    if ((open?.n ?? 0) > 0) throw conflict("battle_exists", "Un duel est déjà en cours ou en attente avec ce joueur.");
    const [created] = await tx
      .insert(b)
      .values({
        challengerId,
        opponentId: opponent.id,
        seed: randomBytes(16).toString("hex"),
        createdAt: ctx.now(),
      })
      .returning();
    await snapshotDeck(tx, created!.id, challengerId, input.deck);
    await fx.notify(tx, opponent.id, "battle_challenge", {
      battleId: created!.id,
      from: await displayName(tx, challengerId),
    });
    return created!;
  });
  await afterCommit(ctx, async () => {
    await fx.flush(ctx);
    ctx.rt.toUser(opponent.id, "battle:update", { battleId: battle.id });
  });
  return { id: battle.id };
}

/** L'adversaire accepte avec son deck : le duel attend que les deux joueurs ouvrent son écran. */
export async function acceptChallenge(ctx: Ctx, userId: string, battleId: number, deck: number[]) {
  const battle = await ctx.db.transaction(async (tx) => {
    const battle = await lockBattle(tx, battleId);
    if (battle.opponentId !== userId) throw forbidden("Ce défi ne t'est pas adressé.");
    if (battle.status !== "pending") throw conflict("battle_closed", "Ce défi n'est plus en attente.");
    if (!ctx.rt.isOnline(battle.challengerId)) {
      throw conflict("opponent_offline", "Ton adversaire n'est pas connecté : réessaie quand il sera en ligne.");
    }
    await snapshotDeck(tx, battleId, userId, deck);
    const now = ctx.now();
    const [started] = await tx
      .update(b)
      .set({
        status: "active",
        startedAt: now,
        phase: "lobby",
        turn: 0,
        phaseStartedAt: now,
        phaseEndsAt: new Date(now.getTime() + LOBBY_TIMEOUT_MS),
        challengerHp: BATTLE_HP,
        opponentHp: BATTLE_HP,
        firstAttackerId: ctx.random(2) === 0 ? battle.challengerId : battle.opponentId,
      })
      .where(eq(b.id, battleId))
      .returning();
    return started!;
  });
  await afterCommit(ctx, async () => {
    const name = await displayName(ctx.db, userId);
    ctx.rt.toUser(battle.challengerId, "battle:update", { battleId, started: true, opponent: name });
    ctx.rt.toUser(battle.opponentId, "battle:update", { battleId });
    engine.schedule(ctx, battle);
    // Résumés des 10 cartes (questions) : chargés en arrière-plan, sans bloquer la réponse.
    void loadDeckSummaries(ctx, battleId).catch((err: unknown) => ctx.log.warn({ err, battleId }, "résumés du duel"));
  });
  return { id: battleId };
}

async function loadDeckSummaries(ctx: Ctx, battleId: number) {
  const rows = await ctx.db.execute<{ id: number; title: string }>(sql`
    select c.id, c.title from battle_decks d join cards c on c.season = d.season and c.id = d.card_id where d.battle_id = ${battleId}
  `);
  await ctx.wiki.load(
    rows.map((r) => ({ cardId: Number(r.id), title: r.title })),
    undefined,
    { fresh: true },
  );
}

export async function refuseChallenge(ctx: Ctx, userId: string, battleId: number) {
  const battle = await ctx.db.transaction(async (tx) => {
    const battle = await lockBattle(tx, battleId);
    if (battle.status !== "pending") throw conflict("battle_closed", "Ce défi n'est plus en attente.");
    if (battle.opponentId !== userId && battle.challengerId !== userId) throw forbidden("Ce défi ne te concerne pas.");
    const status = battle.opponentId === userId ? "declined" : "cancelled";
    await tx.update(b).set({ status, finishedAt: ctx.now() }).where(eq(b.id, battleId));
    return battle;
  });
  ctx.rt.toUser(battle.challengerId, "battle:update", { battleId });
  ctx.rt.toUser(battle.opponentId, "battle:update", { battleId });
}

// ---------------------------------------------------------------------------
// Questions : préparées dès le choix de l'attaque (résumés des leurres chargés pendant le bouclier)
// ---------------------------------------------------------------------------

/** Construit la question d'un tour sur l'article de la carte attaquante (types déjà posés évités). */
async function buildQuestion(ctx: Ctx, battle: Battle, turn: number, attack: DeckRow): Promise<Question> {
  const used = (await turnsOf(ctx.db, battle.id))
    .map((t) => (t.question as Question | null)?.type)
    .filter((t): t is QuestionType => !!t);
  return quizQuestion(ctx, {
    seed: `${battle.seed}:${turn}`,
    cardId: attack.cardId,
    season: attack.season,
    rarity: attack.rarity,
    avoid: used,
  });
}

const preparing = new Map<string, Promise<Question>>();

/** Question du tour, préparée une seule fois par processus (le résultat est ensuite figé en base). */
function questionFor(ctx: Ctx, battle: Battle, turn: number, attack: DeckRow): Promise<Question> {
  const key = `${battle.id}:${turn}`;
  let p = preparing.get(key);
  if (!p) {
    p = buildQuestion(ctx, battle, turn, attack);
    preparing.set(key, p);
    // Nettoyage : la question est stockée en base au passage à la phase « question ».
    void p.catch(() => {}).finally(() => setTimeout(() => preparing.delete(key), 60_000).unref?.());
  }
  return p;
}

// ---------------------------------------------------------------------------
// Moteur : chaque transition se fait en transaction sur la ligne du duel, puis l'état est poussé
// aux deux joueurs et la prochaine échéance est programmée. Les minuteries ne sont qu'un réveil :
// après un redémarrage, elles sont reprogrammées depuis la base (démarrage, reconnexion, balayage).
// ---------------------------------------------------------------------------

function phaseSet(phase: BattlePhase, now: Date, durationMs: number) {
  return { phase, phaseStartedAt: now, phaseEndsAt: new Date(now.getTime() + durationMs) };
}

/** Actions manquées d'affilée : +1 pour une action automatique, remis à 0 sinon. */
function idleSet(battle: Battle, userId: string, missed: boolean) {
  const isC = userId === battle.challengerId;
  const current = isC ? battle.challengerIdle : battle.opponentIdle;
  const next = missed ? current + 1 : 0;
  return isC ? { challengerIdle: next } : { opponentIdle: next };
}

type Step = { battle: Battle; finished?: FinishResult; cancelled?: boolean; prepare?: DeckRow } | null;

async function commitStep(ctx: Ctx, fx: Effects, step: Step) {
  if (!step) return;
  await afterCommit(ctx, async () => {
    if (step.finished) await afterFinish(ctx, fx, step.battle, step.finished);
    else if (step.cancelled) {
      engine.clear(step.battle.id);
      for (const id of [step.battle.challengerId, step.battle.opponentId])
        ctx.rt.toUser(id, "battle:update", { battleId: step.battle.id });
    } else {
      engine.schedule(ctx, step.battle);
      if (step.prepare) void questionFor(ctx, step.battle, step.battle.turn, step.prepare).catch(() => {});
    }
    await pushState(ctx, step.battle);
  });
}

/** Les deux joueurs sont sur l'écran du duel : premier tour. */
async function startBattle(ctx: Ctx, battleId: number) {
  const step = await ctx.db.transaction(async (tx): Promise<Step> => {
    const battle = await lockBattle(tx, battleId);
    if (battle.status !== "active" || battle.phase !== "lobby") return null;
    const [row] = await tx
      .update(b)
      .set({ turn: 1, ...phaseSet("attack", ctx.now(), START_DELAY_MS + ATTACK_TIME_MS) })
      .where(eq(b.id, battleId))
      .returning();
    return { battle: row! };
  });
  await commitStep(ctx, new Effects(), step);
}

/** Personne n'est venu à temps (ou les deux ont lâché) : duel annulé, sans récompense. */
async function cancelBattle(tx: Tx, battle: Battle, now: Date): Promise<Step> {
  const [row] = await tx
    .update(b)
    .set({ status: "cancelled", phase: null, phaseEndsAt: null, finishedAt: now })
    .where(eq(b.id, battle.id))
    .returning();
  return { battle: row!, cancelled: true };
}

/**
 * L'attaquant choisit sa carte (`slot` null : choix automatique, chrono écoulé).
 * `expect` : tour attendu (minuterie), pour ne jamais rejouer une échéance périmée.
 */
export async function chooseAttack(
  ctx: Ctx,
  userId: string | null,
  battleId: number,
  slot: number | null,
  expect?: number,
) {
  const auto = userId === null;
  const fx = new Effects();
  const step = await ctx.db.transaction(async (tx): Promise<Step> => {
    const battle = await lockBattle(tx, battleId);
    if (userId) requireSide(battle, userId);
    if (battle.status !== "active" || battle.phase !== "attack" || (expect !== undefined && battle.turn !== expect)) {
      if (auto) return null;
      throw conflict("wrong_phase", "Ce n'est pas le moment d'attaquer.");
    }
    const attacker = attackerOf(battle, battle.turn);
    if (userId && attacker !== userId) throw conflict("not_your_turn", "C'est à ton adversaire d'attaquer.");
    const used = (await turnsOf(tx, battleId)).filter((t) => t.attackerId === attacker).map((t) => t.attackSlot);
    const free = Array.from({ length: DECK_SIZE }, (_, i) => i + 1).filter((s) => !used.includes(s));
    const chosen = slot ?? pick(ctx, free);
    if (!free.includes(chosen)) throw badRequest("invalid_slot", "Cette carte a déjà attaqué.");
    await tx.insert(bt).values({
      battleId,
      turn: battle.turn,
      attackerId: attacker,
      defenderId: otherOf(battle, attacker),
      attackSlot: chosen,
      attackAuto: auto,
    });
    const [row] = await tx
      .update(b)
      .set({ ...phaseSet("shield", ctx.now(), SHIELD_TIME_MS), ...idleSet(battle, attacker, auto) })
      .where(eq(b.id, battleId))
      .returning();
    const all = await decks(tx, battleId);
    return { battle: row!, prepare: deckOf(all, attacker, chosen) };
  });
  await commitStep(ctx, fx, step);
  return step;
}

/** Le défenseur choisit son bouclier (`slot` null : automatique) ; la question part aussitôt. */
export async function chooseShield(
  ctx: Ctx,
  userId: string | null,
  battleId: number,
  slot: number | null,
  expect?: number,
) {
  const auto = userId === null;
  // Vérification rapide hors verrou, puis la question (éventuellement encore en préparation).
  const [peek] = await ctx.db.select().from(b).where(eq(b.id, battleId));
  if (!peek) throw notFound("Ce duel n'existe pas.");
  if (userId) requireSide(peek, userId);
  if (peek.status !== "active" || peek.phase !== "shield" || (expect !== undefined && peek.turn !== expect)) {
    if (auto) return null;
    throw conflict("wrong_phase", "Ce n'est pas le moment de choisir un bouclier.");
  }
  const defender = otherOf(peek, attackerOf(peek, peek.turn));
  if (userId && userId !== defender) throw conflict("not_your_turn", "C'est ton adversaire qui se défend.");
  const [turnRow] = await ctx.db
    .select()
    .from(bt)
    .where(and(eq(bt.battleId, battleId), eq(bt.turn, peek.turn)));
  if (!turnRow) throw conflict("wrong_phase", "Aucune attaque en cours.");
  const all = await decks(ctx.db, battleId);
  const usedShields = (await turnsOf(ctx.db, battleId))
    .filter((t) => t.defenderId === defender && t.shieldSlot !== null)
    .map((t) => t.shieldSlot!);
  const free = Array.from({ length: DECK_SIZE }, (_, i) => i + 1).filter((s) => !usedShields.includes(s));
  if (slot !== null && !free.includes(slot)) throw badRequest("invalid_slot", "Cette carte a déjà servi de bouclier.");
  const question = await withTimeout(
    questionFor(ctx, peek, peek.turn, deckOf(all, turnRow.attackerId, turnRow.attackSlot)),
    QUESTION_PREP_MS + 2_000,
    null,
  ).then((q) => q ?? buildQuestion(ctx, peek, peek.turn, deckOf(all, turnRow.attackerId, turnRow.attackSlot)));

  const fx = new Effects();
  const step = await ctx.db.transaction(async (tx): Promise<Step> => {
    const battle = await lockBattle(tx, battleId);
    if (battle.status !== "active" || battle.phase !== "shield" || battle.turn !== peek.turn) {
      if (auto) return null;
      throw conflict("wrong_phase", "Ce n'est plus le moment de choisir un bouclier.");
    }
    const now = ctx.now();
    await tx
      .update(bt)
      .set({ shieldSlot: slot ?? pick(ctx, free), shieldAuto: auto, question, servedAt: now })
      .where(and(eq(bt.battleId, battleId), eq(bt.turn, battle.turn)));
    const [row] = await tx
      .update(b)
      .set({ ...phaseSet("question", now, QUESTION_TIME_MS), ...idleSet(battle, defender, auto) })
      .where(eq(b.id, battleId))
      .returning();
    return { battle: row! };
  });
  await commitStep(ctx, fx, step);
  return step;
}

/**
 * Réponse du défenseur (`userId` null : chrono écoulé, pas de réponse). Le temps est mesuré par le
 * serveur depuis l'envoi de la question ; une réponse hors délai compte comme absente.
 */
export async function answerQuestion(
  ctx: Ctx,
  userId: string | null,
  battleId: number,
  choice: number | null,
  expect?: number,
) {
  const auto = userId === null;
  const fx = new Effects();
  const step = await ctx.db.transaction(async (tx): Promise<Step> => {
    const battle = await lockBattle(tx, battleId);
    if (userId) requireSide(battle, userId);
    if (battle.status !== "active" || battle.phase !== "question" || (expect !== undefined && battle.turn !== expect)) {
      if (auto) return null;
      throw conflict("wrong_phase", "Aucune question en cours.");
    }
    const [turn] = await tx
      .select()
      .from(bt)
      .where(and(eq(bt.battleId, battleId), eq(bt.turn, battle.turn)))
      .for("update");
    if (!turn?.question || !turn.servedAt) throw conflict("wrong_phase", "Aucune question en cours.");
    if (userId && userId !== turn.defenderId) throw conflict("not_your_turn", "C'est ton adversaire qui répond.");
    if (turn.answeredAt) throw conflict("already_answered", "Réponse déjà donnée.");
    const now = ctx.now();
    const elapsed = now.getTime() - turn.servedAt.getTime();
    if (auto && elapsed < QUESTION_TIME_MS) return null; // réveil en avance : on attend l'échéance
    const question = turn.question as Question;
    const valid =
      !auto &&
      elapsed <= QUESTION_TIME_MS + ANSWER_GRACE_MS &&
      choice !== null &&
      Number.isInteger(choice) &&
      choice >= 0 &&
      choice < question.choices.length;
    const correct = valid && choice === question.answer;
    const all = await decks(tx, battleId);
    const attack = deckOf(all, turn.attackerId, turn.attackSlot);
    const shield = turn.shieldSlot ? deckOf(all, turn.defenderId, turn.shieldSlot) : null;
    const hit = resolveHit({
      atk: attack.atk,
      rarity: attack.rarity,
      shieldDef: shield?.def ?? null,
      correct,
      answerMs: valid ? Math.max(0, elapsed) : null,
    });
    await tx
      .update(bt)
      .set({
        answeredAt: now,
        choice: valid ? choice : null,
        correct,
        answerMs: valid ? Math.max(0, elapsed) : null,
        rawDamage: hit.raw,
        shieldPct: hit.shieldPct,
        damage: hit.damage,
        reflected: hit.reflected,
      })
      .where(and(eq(bt.battleId, battleId), eq(bt.turn, battle.turn)));
    const hp = (id: string, loss: number) => Math.max(0, hpOf(battle, id) - loss);
    const lossC = battle.challengerId === turn.defenderId ? hit.damage : hit.reflected;
    const lossO = battle.opponentId === turn.defenderId ? hit.damage : hit.reflected;
    const [row] = await tx
      .update(b)
      .set({
        challengerHp: hp(battle.challengerId, lossC),
        opponentHp: hp(battle.opponentId, lossO),
        ...phaseSet("reveal", now, REVEAL_TIME_MS),
        ...idleSet(battle, turn.defenderId, !valid),
      })
      .where(eq(b.id, battleId))
      .returning();
    return { battle: row! };
  });
  await commitStep(ctx, fx, step);
  return step;
}

/** Fin de l'affichage du résultat : abandon pour inactivité, fin du duel, ou tour suivant. */
async function endReveal(ctx: Ctx, battleId: number, expect?: number) {
  const fx = new Effects();
  const step = await ctx.db.transaction(async (tx): Promise<Step> => {
    const battle = await lockBattle(tx, battleId);
    if (battle.status !== "active" || battle.phase !== "reveal" || (expect !== undefined && battle.turn !== expect))
      return null;
    const now = ctx.now();
    const afkC = battle.challengerIdle >= AFK_FORFEIT;
    const afkO = battle.opponentIdle >= AFK_FORFEIT;
    if (afkC && afkO) return cancelBattle(tx, battle, now);
    if (afkC || afkO) return finish(ctx, tx, fx, battle, afkC ? battle.challengerId : battle.opponentId);
    if (battleOver(hpOf(battle, battle.challengerId), hpOf(battle, battle.opponentId), battle.turn))
      return finish(ctx, tx, fx, battle, null);
    const [row] = await tx
      .update(b)
      .set({ turn: battle.turn + 1, ...phaseSet("attack", now, ATTACK_TIME_MS) })
      .where(eq(b.id, battleId))
      .returning();
    return { battle: row! };
  });
  await commitStep(ctx, fx, step);
}

/** Abandon volontaire (en salle d'attente : le duel est simplement annulé). */
export async function forfeit(ctx: Ctx, userId: string, battleId: number) {
  const fx = new Effects();
  const step = await ctx.db.transaction(async (tx): Promise<Step> => {
    const battle = await lockBattle(tx, battleId);
    requireSide(battle, userId);
    if (battle.status !== "active") throw conflict("battle_not_active", "Ce duel n'est pas en cours.");
    if (battle.phase === "lobby") return cancelBattle(tx, battle, ctx.now());
    return finish(ctx, tx, fx, battle, userId);
  });
  await commitStep(ctx, fx, step);
}

/** Échéance d'une phase atteinte : action automatique pour le joueur qui n'a pas joué. */
async function onDue(ctx: Ctx, battleId: number) {
  const [battle] = await ctx.db.select().from(b).where(eq(b.id, battleId));
  if (!battle || battle.status !== "active" || !battle.phaseEndsAt) return;
  const grace = battle.phase === "question" ? ANSWER_GRACE_MS : 0;
  if (ctx.now().getTime() < battle.phaseEndsAt.getTime() + grace - 50) return engine.schedule(ctx, battle);
  switch (battle.phase) {
    case "lobby": {
      const step = await ctx.db.transaction(async (tx): Promise<Step> => {
        const row = await lockBattle(tx, battleId);
        return row.status === "active" && row.phase === "lobby" ? cancelBattle(tx, row, ctx.now()) : null;
      });
      return commitStep(ctx, new Effects(), step);
    }
    case "attack":
      return void (await chooseAttack(ctx, null, battleId, null, battle.turn));
    case "shield":
      return void (await chooseShield(ctx, null, battleId, null, battle.turn));
    case "question":
      return void (await answerQuestion(ctx, null, battleId, null, battle.turn));
    case "reveal":
      return endReveal(ctx, battleId, battle.turn);
  }
}

/** Minuteries et présence sur l'écran du duel (simple réveil : la vérité est en base). */
const engine = (() => {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const joined = new Map<number, Set<string>>();
  /** Une transition à la fois par duel dans ce processus. */
  const queues = new Map<number, Promise<void>>();

  function serial(battleId: number, fn: () => Promise<void>) {
    const prev = queues.get(battleId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(battleId, next);
    void next.finally(() => {
      if (queues.get(battleId) === next) queues.delete(battleId);
    });
    return next;
  }

  function clear(battleId: number) {
    const t = timers.get(battleId);
    if (t) clearTimeout(t);
    timers.delete(battleId);
  }

  function schedule(ctx: Ctx, battle: Battle) {
    clear(battle.id);
    if (battle.status !== "active" || !battle.phaseEndsAt) {
      joined.delete(battle.id);
      return;
    }
    const grace = battle.phase === "question" ? ANSWER_GRACE_MS : 0;
    const delay = Math.max(0, battle.phaseEndsAt.getTime() + grace - ctx.now().getTime());
    const timer = setTimeout(() => {
      timers.delete(battle.id);
      void serial(battle.id, () => onDue(ctx, battle.id)).catch((err: unknown) =>
        ctx.log.error({ err, battleId: battle.id }, "échéance de duel"),
      );
    }, delay);
    timer.unref?.();
    timers.set(battle.id, timer);
  }

  return {
    schedule,
    clear,
    serial,
    has: (battleId: number) => timers.has(battleId),
    /** Un joueur ouvre l'écran du duel (ou se reconnecte) : état complet, démarrage si les deux sont là. */
    async join(ctx: Ctx, userId: string, battleId: number) {
      const set = joined.get(battleId) ?? new Set<string>();
      set.add(userId);
      joined.set(battleId, set);
      const [battle] = await ctx.db.select().from(b).where(eq(b.id, battleId));
      if (!battle) return;
      ctx.rt.toUser(userId, "battle:state", await battleState(ctx, userId, battleId));
      if (battle.status !== "active") return;
      if (!timers.has(battleId)) schedule(ctx, battle);
      const here = (id: string) => set.has(id) && ctx.rt.isOnline(id);
      if (battle.phase === "lobby" && here(battle.challengerId) && here(battle.opponentId)) {
        await serial(battleId, () => startBattle(ctx, battleId));
      }
    },
    stopAll() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      joined.clear();
    },
  };
})();

export const battleEngine = engine;

/** Les actions des joueurs passent par la même file que les minuteries (une transition à la fois). */
export function serialAction<T>(battleId: number, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    void engine.serial(battleId, () => fn().then(resolve, reject));
  });
}

/** Reprend les minuteries des duels en cours (démarrage du serveur). */
export async function resumeBattles(ctx: Ctx) {
  const rows = await ctx.db.select().from(b).where(eq(b.status, "active"));
  for (const battle of rows) engine.schedule(ctx, battle);
}

// ---------------------------------------------------------------------------
// Fin de duel : résultat, Elo, récompenses
// ---------------------------------------------------------------------------

interface FinishResult {
  players: Player[];
  winnerId: string | null;
}

/** Le joueur a fait au moins une action lui-même (attaque, bouclier ou réponse). */
const playedBy = (turns: Turn[], userId: string) =>
  turns.some(
    (t) =>
      (t.attackerId === userId && !t.attackAuto) ||
      (t.defenderId === userId && ((t.shieldSlot !== null && !t.shieldAuto) || t.choice !== null)),
  );

async function finish(ctx: Ctx, tx: Tx, fx: Effects, battle: Battle, forfeitBy: string | null): Promise<Step> {
  const turns = await turnsOf(tx, battle.id);
  const dealt = (id: string) =>
    turns.reduce((s, t) => s + (t.attackerId === id ? (t.damage ?? 0) : (t.reflected ?? 0)), 0);
  const result: 1 | 2 | 0 = forfeitBy
    ? forfeitBy === battle.challengerId
      ? 2
      : 1
    : battleResult(
        hpOf(battle, battle.challengerId),
        hpOf(battle, battle.opponentId),
        dealt(battle.challengerId),
        dealt(battle.opponentId),
      );
  const players = await lockPlayers(tx, [battle.challengerId, battle.opponentId]);
  const c = players.get(battle.challengerId)!;
  const o = players.get(battle.opponentId)!;
  // Anti-farm : plafond de duels récompensés par paire et par jour (Paris), rien pour qui n'a rien joué.
  const [today] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from battles
    where status = 'finished' and id <> ${battle.id}
      and ((challenger_id = ${battle.challengerId} and opponent_id = ${battle.opponentId}) or (challenger_id = ${battle.opponentId} and opponent_id = ${battle.challengerId}))
      and finished_at >= (date_trunc('day', ${ctx.now().toISOString()}::timestamptz at time zone 'Europe/Paris') at time zone 'Europe/Paris')
  `);
  const pairFinishedToday = today?.n ?? 0;
  const rewarded = pairFinishedToday < BATTLE_REWARDED_PER_PAIR_PER_DAY;
  const played = (id: string) => playedBy(turns, id);
  const rated = battleRated({ pairFinishedToday, result, played1: played(c.userId), played2: played(o.userId) });
  const elo = rated ? eloUpdate(c.elo, o.elo, result === 1 ? 1 : result === 2 ? 0 : 0.5) : { r1: c.elo, r2: o.elo };
  for (const [p, rating] of [
    [c, elo.r1],
    [o, elo.r2],
  ] as const) {
    if (rated) {
      await tx
        .update(schema.players)
        .set({ elo: rating, eloPeak: Math.max(p.eloPeak, rating) })
        .where(eq(schema.players.userId, p.userId));
    }
    const outcome = result === 0 ? "draw" : (result === 1) === (p === c) ? "win" : "loss";
    if (rewarded && played(p.userId)) await movePw(tx, p, battleReward(outcome), "battle", battle.id);
  }
  const winnerId = result === 1 ? battle.challengerId : result === 2 ? battle.opponentId : null;
  const [row] = await tx
    .update(b)
    .set({
      status: "finished",
      phase: null,
      phaseEndsAt: null,
      winnerId,
      forfeitBy,
      challengerEloDelta: elo.r1 - c.elo,
      opponentEloDelta: elo.r2 - o.elo,
      finishedAt: ctx.now(),
    })
    .where(eq(b.id, battle.id))
    .returning();
  const names = await tx
    .select({ id: schema.user.id, name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})` })
    .from(schema.user)
    .where(inArray(schema.user.id, [battle.challengerId, battle.opponentId]));
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? "?";
  await fx.notify(tx, battle.challengerId, "battle_result", {
    battleId: battle.id,
    won: result === 1,
    draw: result === 0,
    opponent: nameOf(battle.opponentId),
  });
  await fx.notify(tx, battle.opponentId, "battle_result", {
    battleId: battle.id,
    won: result === 2,
    draw: result === 0,
    opponent: nameOf(battle.challengerId),
  });
  return { battle: row!, finished: { players: [c, o], winnerId } };
}

/** Le joueur a touché des PW pour ce duel (dans le quota anti-farm et a joué lui-même). */
export async function battleRewarded(db: DbOrTx, userId: string, battleId: number): Promise<boolean> {
  const [row] = await db.execute(
    sql`select 1 from ledger where user_id = ${userId} and reason = 'battle' and ref_id = ${String(battleId)} limit 1`,
  );
  return !!row;
}

/**
 * Une question de duel attend la réponse de ce joueur : le catalogue et les fiches sont refusés
 * pendant ce temps (recherche de l'extrait masqué d'un « Qui suis-je ? »…).
 */
export async function answeringQuestion(ctx: Ctx, userId: string): Promise<boolean> {
  const [row] = await ctx.db.execute(sql`
    select 1 from battles x join battle_turns t on t.battle_id = x.id and t.turn = x.turn
    where x.status = 'active' and x.phase = 'question' and t.defender_id = ${userId} and t.answered_at is null
    limit 1
  `);
  return !!row;
}

/** Hooks après un duel terminé (succès, objectifs de guilde). */
type FinishHook = (ctx: Ctx, battle: Battle, winnerId: string | null) => Promise<void>;
const finishHooks: FinishHook[] = [];
export const onBattleFinished = (hook: FinishHook) => finishHooks.push(hook);

async function afterFinish(ctx: Ctx, fx: Effects, battle: Battle, done: FinishResult) {
  engine.clear(battle.id);
  for (const p of done.players) pushWallet(ctx, p);
  // Anti-farm : seule une victoire récompensée fait avancer l'objectif de guilde.
  if (done.winnerId && (await battleRewarded(ctx.db, done.winnerId, battle.id)))
    await bumpObjective(ctx, done.winnerId, { win_battles: 1 });
  ctx.rt.toUser(battle.challengerId, "battle:update", { battleId: battle.id });
  ctx.rt.toUser(battle.opponentId, "battle:update", { battleId: battle.id });
  await fx.flush(ctx);
  for (const hook of finishHooks) await hook(ctx, battle, done.winnerId);
}

/** Termine de force un duel en cours (suppression de compte) : abandon de ce joueur. */
export async function forceFinish(ctx: Ctx, battleId: number, forfeitBy?: string) {
  const fx = new Effects();
  const step = await ctx.db.transaction(async (tx): Promise<Step> => {
    const battle = await lockBattle(tx, battleId);
    if (battle.status !== "active") return null;
    if (battle.phase === "lobby") return cancelBattle(tx, battle, ctx.now());
    return finish(ctx, tx, fx, battle, forfeitBy ?? null);
  });
  await commitStep(ctx, fx, step);
}

/** Rattrapage : défis expirés et échéances de duels manquées (redémarrage, minuterie perdue). */
export async function sweepBattles(ctx: Ctx) {
  const now = ctx.now().getTime();
  const rows = await ctx.db
    .select()
    .from(b)
    .where(inArray(b.status, ["pending", "active"]));
  for (const battle of rows) {
    try {
      if (battle.status === "pending" && now - battle.createdAt.getTime() > CHALLENGE_TTL_MS) {
        await ctx.db
          .update(b)
          .set({ status: "cancelled", finishedAt: ctx.now() })
          .where(and(eq(b.id, battle.id), eq(b.status, "pending")));
      } else if (battle.status === "active" && !engine.has(battle.id)) {
        engine.schedule(ctx, battle);
      }
    } catch (err) {
      ctx.log.error({ err, battleId: battle.id }, "rattrapage de duel");
    }
  }
}

// ---------------------------------------------------------------------------
// État d'un duel vu par un joueur
// ---------------------------------------------------------------------------

type DeckCardRow = {
  user_id: string;
  slot: number;
  instance_id: string | number;
  card_id: string | number;
  season: number;
  rarity: Rarity;
  atk: number;
  def: number;
  title: string;
  thumb_url: string | null;
  page_url: string | null;
  level: number;
};

async function deckCards(db: DbOrTx, battleId: number): Promise<DeckCardRow[]> {
  return db.execute<DeckCardRow>(sql`
    select d.user_id, d.slot, d.instance_id, d.card_id, d.season, d.rarity, d.atk, d.def, c.title,
           w.thumb_url, w.page_url, coalesce(i.level, 1) as level
    from battle_decks d
    join cards c on c.season = d.season and c.id = d.card_id
    left join wiki_summaries w on w.page_id = d.card_id
    left join card_instances i on i.id = d.instance_id
    where d.battle_id = ${battleId}
    order by d.slot
  `);
}

function toCard(r: DeckCardRow): CardDTO {
  return {
    instanceId: Number(r.instance_id),
    cardId: Number(r.card_id),
    season: r.season,
    title: r.title,
    rarity: r.rarity,
    atk: r.atk,
    def: r.def,
    level: r.level,
    thumbUrl: r.thumb_url,
    pageUrl: r.page_url ?? articleUrl(r.title),
  };
}

const remaining = (battle: Battle, now: Date) =>
  battle.phaseEndsAt ? Math.max(0, battle.phaseEndsAt.getTime() - now.getTime()) : null;

export async function battleState(ctx: Ctx, userId: string, battleId: number): Promise<BattleStateDTO> {
  const [battle] = await ctx.db.select().from(b).where(eq(b.id, battleId));
  if (!battle) throw notFound("Ce duel n'existe pas.");
  requireSide(battle, userId);
  const otherId = otherOf(battle, userId);
  const finished = battle.status === "finished";
  const legacy = finished && battle.challengerHp === null;
  const [cards, turns, users] = await Promise.all([
    deckCards(ctx.db, battleId),
    turnsOf(ctx.db, battleId),
    ctx.db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})`,
      })
      .from(schema.user)
      .where(inArray(schema.user.id, [userId, otherId])),
  ]);
  const userOf = (id: string) => users.find((u) => u.id === id);

  /** Une carte adverse est révélée quand elle a attaqué (question posée, titre visible) ou à la fin. */
  const revealed = (ownerId: string, slot: number) =>
    ownerId === userId ||
    finished ||
    turns.some(
      (t) =>
        t.attackerId === ownerId &&
        t.attackSlot === slot &&
        t.servedAt &&
        t.question &&
        (!cardHiddenUntilAnswer(t.question as Question) || t.answeredAt),
    );
  const view = (ownerId: string, slot: number): BattleCardView => {
    const r = cards.find((c) => c.user_id === ownerId && c.slot === slot)!;
    return {
      slot,
      rarity: r.rarity,
      atk: r.atk,
      def: r.def,
      damage: attackDamage(r.atk, r.rarity),
      shieldPct: shieldPercent(r.def),
      attacked: turns.some((t) => t.attackerId === ownerId && t.attackSlot === slot),
      shielded: turns.some((t) => t.defenderId === ownerId && t.shieldSlot === slot),
      card: revealed(ownerId, slot) ? toCard(r) : null,
    };
  };
  const turnView = (t: Turn): BattleTurnView => {
    const q = t.question as Question | null;
    return {
      turn: t.turn,
      attackerId: t.attackerId,
      defenderId: t.defenderId,
      attack: view(t.attackerId, t.attackSlot),
      shield: t.shieldSlot ? view(t.defenderId, t.shieldSlot) : null,
      attackAuto: t.attackAuto,
      shieldAuto: t.shieldAuto,
      question:
        q && t.servedAt ? { type: q.type, prompt: q.prompt, choices: q.choices, titleHidden: q.titleHidden } : null,
      outcome:
        q && t.answeredAt
          ? {
              choice: t.choice,
              correctIndex: q.answer,
              correct: !!t.correct,
              answerMs: t.answerMs,
              rawDamage: t.rawDamage ?? 0,
              shieldPct: t.shieldPct ?? 0,
              damage: t.damage ?? 0,
              reflected: t.reflected ?? 0,
              parry: t.correct ? (t.reflected ? "perfect" : "parry") : "none",
            }
          : null,
    };
  };
  const hand = (ownerId: string) => cards.filter((c) => c.user_id === ownerId).map((c) => view(ownerId, c.slot));
  const active = battle.status === "active";
  const current = active ? turns.find((t) => t.turn === battle.turn) : undefined;
  const isC = battle.challengerId === userId;
  const ledger = finished
    ? await ctx.db.execute<{ delta: string }>(
        sql`select delta from ledger where user_id = ${userId} and reason = 'battle' and ref_id = ${String(battleId)} limit 1`,
      )
    : [];
  const player = (id: string) => ({
    id,
    name: userOf(id)?.name ?? "?",
    username: userOf(id)?.username ?? "",
    hp: id === battle.challengerId ? battle.challengerHp : battle.opponentHp,
    online: ctx.rt.isOnline(id),
    idle: id === battle.challengerId ? battle.challengerIdle : battle.opponentIdle,
  });
  return {
    id: battle.id,
    status: battle.status,
    phase: active ? battle.phase : null,
    turn: battle.turn,
    totalTurns: TOTAL_TURNS,
    maxHp: BATTLE_HP,
    phaseRemainingMs: active ? remaining(battle, ctx.now()) : null,
    phaseDurationMs:
      active && battle.phaseEndsAt && battle.phaseStartedAt
        ? battle.phaseEndsAt.getTime() - battle.phaseStartedAt.getTime()
        : null,
    isChallenger: isC,
    legacy,
    you: player(userId),
    them: player(otherId),
    attackerId: active && battle.turn > 0 ? attackerOf(battle, battle.turn) : null,
    myHand: hand(userId),
    theirHand: hand(otherId),
    current: current ? turnView(current) : null,
    turns: turns.filter((t) => t.answeredAt && (!active || t.turn !== battle.turn)).map(turnView),
    result: finished
      ? {
          outcome: battle.winnerId === null ? "draw" : battle.winnerId === userId ? "win" : "loss",
          eloDelta: isC ? battle.challengerEloDelta : battle.opponentEloDelta,
          forfeitBy: battle.forfeitBy ? (battle.forfeitBy === userId ? "you" : "them") : null,
          reward: ledger[0] ? Number(ledger[0].delta) : null,
        }
      : null,
    createdAt: battle.createdAt.toISOString(),
  };
}

/** Pousse l'état du duel aux deux joueurs (chacun sa vue). */
async function pushState(ctx: Ctx, battle: Battle) {
  for (const id of [battle.challengerId, battle.opponentId]) {
    try {
      ctx.rt.toUser(id, "battle:state", await battleState(ctx, id, battle.id));
    } catch (err) {
      ctx.log.warn({ err, battleId: battle.id }, "état du duel");
    }
  }
}

export async function isParticipant(ctx: Ctx, userId: string, battleId: number) {
  const [row] = await ctx.db
    .select({ id: b.id })
    .from(b)
    .where(and(eq(b.id, battleId), or(eq(b.challengerId, userId), eq(b.opponentId, userId))));
  return !!row;
}

export async function listBattles(ctx: Ctx, userId: string) {
  const rows = await ctx.db
    .select()
    .from(b)
    .where(or(eq(b.challengerId, userId), eq(b.opponentId, userId)))
    .orderBy(desc(b.createdAt))
    .limit(60);
  const ids = [...new Set(rows.flatMap((r) => [r.challengerId, r.opponentId]))];
  const users = ids.length
    ? await ctx.db
        .select({
          id: schema.user.id,
          username: schema.user.username,
          name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})`,
        })
        .from(schema.user)
        .where(inArray(schema.user.id, ids))
    : [];
  const userBy = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const isChallenger = r.challengerId === userId;
    const otherId = isChallenger ? r.opponentId : r.challengerId;
    const other = userBy.get(otherId);
    const mine = isChallenger ? r.challengerHp : r.opponentHp;
    const theirs = isChallenger ? r.opponentHp : r.challengerHp;
    return {
      id: r.id,
      status: r.status,
      phase: r.phase,
      isChallenger,
      opponent: {
        id: otherId,
        name: other?.name ?? "?",
        username: other?.username ?? "",
        online: ctx.rt.isOnline(otherId),
      },
      hp: mine === null || theirs === null ? null : { you: mine, them: theirs },
      result: r.status !== "finished" ? null : r.winnerId === null ? "draw" : r.winnerId === userId ? "win" : "loss",
      forfeit: r.forfeitBy ? (r.forfeitBy === userId ? "you" : "them") : null,
      eloDelta: isChallenger ? r.challengerEloDelta : r.opponentEloDelta,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    };
  });
}

/** Pour les tests : rejoue l'échéance de la phase en cours comme si la minuterie avait sonné. */
export const runDue = (ctx: Ctx, battleId: number) => engine.serial(battleId, () => onDue(ctx, battleId));
