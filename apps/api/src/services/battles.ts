import { and, asc, desc, eq, inArray, or, schema, sql } from "@palacards/db";
import {
  ANSWER_GRACE_MS,
  ASYNC_BATTLE_TTL_MS,
  BATTLE_REWARDED_PER_PAIR_PER_DAY,
  BATTLE_ROUNDS,
  battleOver,
  battleRated,
  battleResult,
  battleReward,
  CHALLENGE_TTL_MS,
  DECK_SIZE,
  effectiveStats,
  eloUpdate,
  makeQuestion,
  QUESTION_TIME_MS,
  roundPower,
  roundWinner,
  seededRandom,
  type Question,
  type QuizCard,
  type Rarity,
} from "@palacards/game";
import type { BattleAnswerDTO, BattleQuestionDTO, BattleRoundResultDTO, CardDTO } from "@palacards/shared";
import { randomBytes } from "node:crypto";
import type { Ctx } from "../context.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { instancesByIds } from "./cards.js";
import { afterCommit, Effects } from "./notifications.js";
import { bumpObjective } from "./guilds.js";
import { lockPlayers, movePw, pushWallet, type DbOrTx, type Player } from "./players.js";
import { findUserByName } from "./profiles.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type Battle = typeof schema.battles.$inferSelect;
type DeckRow = typeof schema.battleDecks.$inferSelect;

const b = schema.battles;
export const battleRoom = (id: number) => `battle:${id}`;
/** Pause entre deux manches d'un duel en direct (le temps de lire le résultat). */
const LIVE_PAUSE_MS = 3_500;
/** Un duel en direct sans activité depuis ce délai est terminé par le rattrapage (redémarrage du serveur…). */
const LIVE_STALE_MS = 3 * 60_000;

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

export async function challenge(
  ctx: Ctx,
  challengerId: string,
  input: { opponent: string; mode: "live" | "async"; deck: number[] },
) {
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
        mode: input.mode,
        seed: randomBytes(16).toString("hex"),
        createdAt: ctx.now(),
      })
      .returning();
    await snapshotDeck(tx, created!.id, challengerId, input.deck);
    const [me] = await tx
      .select({ name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})` })
      .from(schema.user)
      .where(eq(schema.user.id, challengerId));
    await fx.notify(tx, opponent.id, "battle_challenge", {
      battleId: created!.id,
      from: me?.name ?? "?",
      mode: input.mode,
    });
    return created!;
  });
  await afterCommit(ctx, () => fx.flush(ctx));
  return { id: battle.id };
}

async function lockBattle(tx: Tx, battleId: number): Promise<Battle> {
  const [row] = await tx.select().from(b).where(eq(b.id, battleId)).for("update");
  if (!row) throw notFound("Ce duel n'existe pas.");
  return row;
}

/** L'adversaire accepte avec son deck : le duel commence (en direct : dès que les deux sont là). */
export async function acceptChallenge(ctx: Ctx, userId: string, battleId: number, deck: number[]) {
  const battle = await ctx.db.transaction(async (tx) => {
    const battle = await lockBattle(tx, battleId);
    if (battle.opponentId !== userId) throw forbidden("Ce défi ne t'est pas adressé.");
    if (battle.status !== "pending") throw conflict("battle_closed", "Ce défi n'est plus en attente.");
    if (battle.mode === "live" && !ctx.rt.isOnline(battle.challengerId)) {
      throw conflict("opponent_offline", "Ton adversaire n'est pas connecté : réessaie quand il sera en ligne.");
    }
    await snapshotDeck(tx, battleId, userId, deck);
    const [started] = await tx
      .update(b)
      .set({ status: "active", startedAt: ctx.now() })
      .where(eq(b.id, battleId))
      .returning();
    return started!;
  });
  await afterCommit(ctx, async () => {
    ctx.rt.toUser(battle.challengerId, "battle:update", { battleId });
    ctx.rt.toUser(battle.opponentId, "battle:update", { battleId });
    // Les résumés des 10 cartes servent aux questions « Qui suis-je ? » : chargés en arrière-plan,
    // sans bloquer la réponse (une manche sans résumé se rabat sur « plus lu » / « plus long »).
    void loadSummaries(ctx, battleId)
      .catch((err: unknown) => ctx.log.warn({ err, battleId }, "résumés du duel"))
      .finally(() => {
        if (battle.mode === "live") live.maybeStart(ctx, battleId);
      });
  });
  return { id: battleId };
}

async function loadSummaries(ctx: Ctx, battleId: number) {
  const rows = await ctx.db.execute<{ id: number; title: string }>(sql`
    select c.id, c.title from battle_decks d join cards c on c.season = d.season and c.id = d.card_id where d.battle_id = ${battleId}
  `);
  await ctx.wiki.load(rows.map((r) => ({ cardId: r.id, title: r.title })));
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
// Questions et réponses (communs au direct et à l'asynchrone)
// ---------------------------------------------------------------------------

async function quizCard(db: DbOrTx, d: DeckRow): Promise<QuizCard & { rarity: Rarity; title: string }> {
  const [row] = await db.execute<{ title: string; views_12m: string; page_len: number; extract: string | null }>(sql`
    select c.title, c.views_12m, c.page_len, w.extract from cards c left join wiki_summaries w on w.page_id = c.id
    where c.season = ${d.season} and c.id = ${d.cardId}
  `);
  return {
    cardId: d.cardId,
    title: row?.title ?? "?",
    views12m: Number(row?.views_12m ?? 0),
    pageLen: row?.page_len ?? 0,
    extract: row?.extract ?? null,
    rarity: d.rarity,
  };
}

/** Leurres « Qui suis-je ? » : titres de la saison et de la rareté de la carte visée, choisis par la graine (index de tirage). */
async function decoys(db: DbOrTx, seed: string, round: number, season: number, rarity: Rarity): Promise<string[]> {
  const key = seededRandom(`${seed}:${round}:decoys`)();
  const rows = await db.execute<{ title: string }>(sql`
    (select title from cards where season = ${season} and rarity = ${rarity}::rarity and rand_key >= ${key} order by rand_key limit 8)
    union all
    (select title from cards where season = ${season} and rarity = ${rarity}::rarity order by rand_key limit 8)
  `);
  return [...new Set(rows.map((r) => r.title))].slice(0, 8);
}

async function decks(db: DbOrTx, battleId: number) {
  const rows = await db
    .select()
    .from(schema.battleDecks)
    .where(eq(schema.battleDecks.battleId, battleId))
    .orderBy(asc(schema.battleDecks.slot));
  return rows;
}

/** Génère la question d'une manche à partir de la graine (et, pour une manche rejouée, de la question à éviter). */
async function buildQuestion(tx: Tx, battle: Battle, round: number, seed: string, avoid?: Question): Promise<Question> {
  const all = await decks(tx, battle.id);
  const a = all.find((d) => d.userId === battle.challengerId && d.slot === round)!;
  const o = all.find((d) => d.userId === battle.opponentId && d.slot === round)!;
  const qa = await quizCard(tx, a);
  const qo = await quizCard(tx, o);
  const target = qa.extract ? a : o;
  return makeQuestion(seed, round, qa, qo, await decoys(tx, seed, round, target.season, target.rarity), avoid);
}

/** Question d'une manche : générée une fois (même graine pour les deux joueurs), puis stockée. */
async function ensureRound(tx: Tx, battle: Battle, round: number): Promise<Question> {
  const [existing] = await tx
    .select()
    .from(schema.battleRounds)
    .where(and(eq(schema.battleRounds.battleId, battle.id), eq(schema.battleRounds.round, round)));
  if (existing) return existing.question as Question;
  const question = await buildQuestion(tx, battle, round, battle.seed);
  await tx.insert(schema.battleRounds).values({ battleId: battle.id, round, question }).onConflictDoNothing();
  const [stored] = await tx
    .select()
    .from(schema.battleRounds)
    .where(and(eq(schema.battleRounds.battleId, battle.id), eq(schema.battleRounds.round, round)));
  return stored!.question as Question;
}

function sideOf(battle: Battle, userId: string): "challenger" | "opponent" {
  if (battle.challengerId === userId) return "challenger";
  if (battle.opponentId === userId) return "opponent";
  throw forbidden("Ce duel ne te concerne pas.");
}

async function roundCards(db: DbOrTx, battle: Battle, userId: string, round: number) {
  const all = await decks(db, battle.id);
  const mine = all.find((d) => d.userId === userId && d.slot === round)!;
  const theirs = all.find((d) => d.userId !== userId && d.slot === round)!;
  const cards = await instancesByIds(db, [mine.instanceId, theirs.instanceId], null);
  const fallback = async (d: DeckRow): Promise<CardDTO> => {
    const q = await quizCard(db, d);
    return {
      instanceId: d.instanceId,
      cardId: d.cardId,
      season: d.season,
      title: q.title,
      rarity: d.rarity,
      atk: d.atk,
      def: d.def,
      level: 1,
      thumbUrl: null,
      pageUrl: null,
    };
  };
  // Stats figées au moment du défi (le deck ne bouge plus même si la carte a changé depuis).
  // Jamais de vues : elles donneraient la réponse à « plus lu ».
  const view = async (d: DeckRow) => {
    const { views12m: _views, ...c } = cards.find((x) => x.instanceId === d.instanceId) ?? (await fallback(d));
    return { ...c, atk: d.atk, def: d.def };
  };
  return { mine: await view(mine), theirs: await view(theirs) };
}

/**
 * Sert la question d'une manche au joueur et démarre son chrono (heure du serveur).
 * Redemander la question ne relance pas le chrono.
 */
export async function serveQuestion(
  ctx: Ctx,
  userId: string,
  battleId: number,
  round: number,
): Promise<BattleQuestionDTO> {
  const res = await ctx.db.transaction(async (tx) => {
    const battle = await lockBattle(tx, battleId);
    sideOf(battle, userId);
    if (battle.status !== "active") throw conflict("battle_not_active", "Ce duel n'est pas en cours.");
    if (!Number.isInteger(round) || round < 1 || round > BATTLE_ROUNDS)
      throw badRequest("invalid_round", "Manche invalide.");
    // Asynchrone : les manches se jouent dans l'ordre ; direct : seule la manche en cours est servie.
    const answered = await tx
      .select({ round: schema.battleAnswers.round, answeredAt: schema.battleAnswers.answeredAt })
      .from(schema.battleAnswers)
      .where(and(eq(schema.battleAnswers.battleId, battleId), eq(schema.battleAnswers.userId, userId)));
    const done = answered.filter((x) => x.answeredAt).map((x) => x.round);
    const expected = done.length ? Math.max(...done) + 1 : 1;
    if (battle.mode === "async" && round !== expected) throw conflict("wrong_round", "Joue les manches dans l'ordre.");
    if (battle.mode === "live" && live.currentRound(battleId) !== round)
      throw conflict("wrong_round", "Cette manche n'est pas en cours.");
    const question = await ensureRound(tx, battle, round);
    await tx
      .insert(schema.battleAnswers)
      .values({ battleId, round, userId, servedAt: live.roundStart(battleId, round) ?? ctx.now() })
      .onConflictDoNothing();
    const [ans] = await tx
      .select()
      .from(schema.battleAnswers)
      .where(
        and(
          eq(schema.battleAnswers.battleId, battleId),
          eq(schema.battleAnswers.round, round),
          eq(schema.battleAnswers.userId, userId),
        ),
      );
    return { battle, question, servedAt: ans!.servedAt, answered: !!ans!.answeredAt };
  });
  const cards = await roundCards(ctx.db, res.battle, userId, round);
  return {
    battleId,
    round,
    type: res.question.type,
    prompt: res.question.prompt,
    choices: res.question.choices,
    deadline: new Date(res.servedAt.getTime() + QUESTION_TIME_MS).toISOString(),
    timeLimitMs: QUESTION_TIME_MS,
    remainingMs: Math.max(0, res.servedAt.getTime() + QUESTION_TIME_MS - ctx.now().getTime()),
    answered: res.answered,
    yourCard: cards.mine,
    theirCard: res.answered ? cards.theirs : null,
  };
}

/** Enregistre la réponse d'un joueur ; le temps est mesuré par le serveur depuis l'envoi de la question. */
export async function answerQuestion(
  ctx: Ctx,
  userId: string,
  battleId: number,
  round: number,
  choice: number,
): Promise<BattleAnswerDTO> {
  const res = await ctx.db.transaction(async (tx) => {
    const battle = await lockBattle(tx, battleId);
    const side = sideOf(battle, userId);
    if (battle.status !== "active") throw conflict("battle_not_active", "Ce duel n'est pas en cours.");
    const [ans] = await tx
      .select()
      .from(schema.battleAnswers)
      .where(
        and(
          eq(schema.battleAnswers.battleId, battleId),
          eq(schema.battleAnswers.round, round),
          eq(schema.battleAnswers.userId, userId),
        ),
      )
      .for("update");
    if (!ans) throw conflict("not_served", "Cette question ne t'a pas encore été posée.");
    if (ans.answeredAt) throw conflict("already_answered", "Tu as déjà répondu.");
    const question = await ensureRound(tx, battle, round);
    const now = ctx.now();
    const elapsed = now.getTime() - ans.servedAt.getTime();
    const inTime = elapsed <= QUESTION_TIME_MS + ANSWER_GRACE_MS;
    const valid = inTime && Number.isInteger(choice) && choice >= 0 && choice < question.choices.length;
    const correct = valid && choice === question.answer;
    const timeLeft = valid ? Math.max(0, QUESTION_TIME_MS - elapsed) : 0;
    const all = await decks(tx, battleId);
    const mine = all.find((d) => d.userId === userId && d.slot === round)!;
    const theirs = all.find((d) => d.userId !== userId && d.slot === round)!;
    const power = roundPower(mine.atk, theirs.def, correct, timeLeft);
    await tx
      .update(schema.battleAnswers)
      .set({ answeredAt: now, choice: valid ? choice : null, correct, timeLeftMs: timeLeft, power })
      .where(
        and(
          eq(schema.battleAnswers.battleId, battleId),
          eq(schema.battleAnswers.round, round),
          eq(schema.battleAnswers.userId, userId),
        ),
      );
    return { battle, side, question, correct, power, timeLeft, valid };
  });
  const { theirs } = await roundCards(ctx.db, res.battle, userId, round);
  const result = {
    battleId,
    round,
    correctIndex: res.question.answer,
    yourChoice: res.valid ? choice : null,
    correct: res.correct,
    yourPower: res.power,
    timeLeftMs: res.timeLeft,
    theirCard: theirs,
  };
  await afterCommit(ctx, async () => {
    if (res.battle.mode === "live") await live.onAnswer(ctx, battleId, round);
    else await maybeFinishAsync(ctx, battleId);
  });
  return result;
}

// ---------------------------------------------------------------------------
// Fin de duel : manches, score, Elo, récompenses
// ---------------------------------------------------------------------------

/** Clôt les réponses manquantes d'une manche (absence = mauvaise réponse, sans bonus de temps). */
async function closeMissing(tx: Tx, battle: Battle, round: number, now: Date) {
  const all = await decks(tx, battle.id);
  for (const userId of [battle.challengerId, battle.opponentId]) {
    const mine = all.find((d) => d.userId === userId && d.slot === round)!;
    const theirs = all.find((d) => d.userId !== userId && d.slot === round)!;
    const power = roundPower(mine.atk, theirs.def, false, 0);
    await tx
      .insert(schema.battleAnswers)
      .values({ battleId: battle.id, round, userId, servedAt: now })
      .onConflictDoNothing();
    await tx
      .update(schema.battleAnswers)
      .set({ answeredAt: now, choice: null, correct: false, timeLeftMs: 0, power })
      .where(
        and(
          eq(schema.battleAnswers.battleId, battle.id),
          eq(schema.battleAnswers.round, round),
          eq(schema.battleAnswers.userId, userId),
          sql`${schema.battleAnswers.answeredAt} is null`,
        ),
      );
  }
}

interface RoundOutcome {
  round: number;
  winner: 1 | 2 | 0;
  p1: number;
  p2: number;
}

/** Calcule les manches jouées (dans l'ordre) : le duel s'arrête dès 3 manches gagnées. */
async function scoreRounds(tx: DbOrTx, battle: Battle, upTo: number) {
  const answers = await tx.select().from(schema.battleAnswers).where(eq(schema.battleAnswers.battleId, battle.id));
  const all = await decks(tx, battle.id);
  const outcomes: RoundOutcome[] = [];
  let s1 = 0;
  let s2 = 0;
  for (let r = 1; r <= upTo; r++) {
    const a1 = answers.find((x) => x.round === r && x.userId === battle.challengerId);
    const a2 = answers.find((x) => x.round === r && x.userId === battle.opponentId);
    if (!a1?.answeredAt || !a2?.answeredAt) break;
    const d1 = all.find((d) => d.userId === battle.challengerId && d.slot === r)!;
    const d2 = all.find((d) => d.userId === battle.opponentId && d.slot === r)!;
    const winner = roundWinner({ power: a1.power ?? 0, def: d1.def }, { power: a2.power ?? 0, def: d2.def });
    if (winner === 1) s1++;
    if (winner === 2) s2++;
    outcomes.push({ round: r, winner, p1: a1.power ?? 0, p2: a2.power ?? 0 });
    if (battleOver(s1, s2, r)) break;
  }
  return { outcomes, s1, s2, over: outcomes.length > 0 && battleOver(s1, s2, outcomes.length) };
}

async function finish(ctx: Ctx, tx: Tx, fx: Effects, battle: Battle, outcomes: RoundOutcome[], s1: number, s2: number) {
  const total1 = outcomes.reduce((s, o) => s + o.p1, 0);
  const total2 = outcomes.reduce((s, o) => s + o.p2, 0);
  const result = battleResult(s1, s2, total1, total2);
  const players = await lockPlayers(tx, [battle.challengerId, battle.opponentId]);
  const c = players.get(battle.challengerId)!;
  const o = players.get(battle.opponentId)!;
  // Anti-farm : plafond de duels récompensés par paire et par jour (Paris), rien pour qui n'a répondu à aucune manche.
  const [today] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from battles
    where status = 'finished' and id <> ${battle.id}
      and ((challenger_id = ${battle.challengerId} and opponent_id = ${battle.opponentId}) or (challenger_id = ${battle.opponentId} and opponent_id = ${battle.challengerId}))
      and finished_at >= (date_trunc('day', ${ctx.now().toISOString()}::timestamptz at time zone 'Europe/Paris') at time zone 'Europe/Paris')
  `);
  const pairFinishedToday = today?.n ?? 0;
  const rewarded = pairFinishedToday < BATTLE_REWARDED_PER_PAIR_PER_DAY;
  const answered = await tx.execute<{ user_id: string }>(sql`
    select distinct user_id from battle_answers where battle_id = ${battle.id} and choice is not null
  `);
  const played = new Set(answered.map((r) => r.user_id));
  // Même plafond pour l'Elo, et aucun Elo contre un perdant qui n'a pas joué (comptes secondaires).
  const rated = battleRated({
    pairFinishedToday,
    result,
    answered1: played.has(c.userId),
    answered2: played.has(o.userId),
  });
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
    if (rewarded && played.has(p.userId)) await movePw(tx, p, battleReward(outcome), "battle", battle.id);
  }
  const winnerId = result === 1 ? battle.challengerId : result === 2 ? battle.opponentId : null;
  for (const r of outcomes) {
    await tx
      .update(schema.battleRounds)
      .set({ winnerId: r.winner === 1 ? battle.challengerId : r.winner === 2 ? battle.opponentId : null })
      .where(and(eq(schema.battleRounds.battleId, battle.id), eq(schema.battleRounds.round, r.round)));
  }
  await tx
    .update(b)
    .set({
      status: "finished",
      winnerId,
      challengerScore: s1,
      opponentScore: s2,
      challengerEloDelta: elo.r1 - c.elo,
      opponentEloDelta: elo.r2 - o.elo,
      finishedAt: ctx.now(),
    })
    .where(eq(b.id, battle.id));
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
  return { players: [c, o], winnerId, result };
}

/** Le joueur a touché des PW pour ce duel (dans le quota anti-farm et a répondu au moins une fois). */
export async function battleRewarded(db: DbOrTx, userId: string, battleId: number): Promise<boolean> {
  const [row] = await db.execute(
    sql`select 1 from ledger where user_id = ${userId} and reason = 'battle' and ref_id = ${String(battleId)} limit 1`,
  );
  return !!row;
}

/**
 * Une question de duel attend la réponse de ce joueur (10 s + tolérance) : le catalogue et les fiches
 * sont refusés pendant ce temps, sinon vues, longueur et rareté donneraient la réponse de « Plus lu » / « Plus long ».
 */
export async function answeringQuestion(ctx: Ctx, userId: string): Promise<boolean> {
  const since = new Date(ctx.now().getTime() - QUESTION_TIME_MS - ANSWER_GRACE_MS);
  const [row] = await ctx.db.execute(
    sql`select 1 from battle_answers where user_id = ${userId} and answered_at is null and served_at > ${since.toISOString()} limit 1`,
  );
  return !!row;
}

/** Hooks après un duel terminé (succès, objectifs de guilde). */
type FinishHook = (ctx: Ctx, battle: Battle, winnerId: string | null) => Promise<void>;
const finishHooks: FinishHook[] = [];
export const onBattleFinished = (hook: FinishHook) => finishHooks.push(hook);

async function afterFinish(ctx: Ctx, fx: Effects, battle: Battle, players: Player[], winnerId: string | null) {
  await afterCommit(ctx, async () => {
    for (const p of players) pushWallet(ctx, p);
    // Anti-farm : seule une victoire récompensée fait avancer l'objectif de guilde.
    if (winnerId && (await battleRewarded(ctx.db, winnerId, battle.id)))
      await bumpObjective(ctx, winnerId, { win_battles: 1 });
    ctx.rt.toUser(battle.challengerId, "battle:update", { battleId: battle.id });
    ctx.rt.toUser(battle.opponentId, "battle:update", { battleId: battle.id });
    await fx.flush(ctx);
    for (const hook of finishHooks) await hook(ctx, battle, winnerId);
  });
}

/** Asynchrone : le résultat tombe quand les deux joueurs ont fini (ou que le duel est joué d'avance). */
async function maybeFinishAsync(ctx: Ctx, battleId: number) {
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const battle = await lockBattle(tx, battleId);
    if (battle.status !== "active") return null;
    const scored = await scoreRounds(tx, battle, BATTLE_ROUNDS);
    if (!scored.over) return null;
    const done = await finish(ctx, tx, fx, battle, scored.outcomes, scored.s1, scored.s2);
    return { battle, ...done };
  });
  if (res) await afterFinish(ctx, fx, res.battle, res.players, res.winnerId);
}

/** Termine de force un duel (délai dépassé, direct interrompu) : les manches non jouées sont perdues par l'absent. */
export async function forceFinish(ctx: Ctx, battleId: number) {
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const battle = await lockBattle(tx, battleId);
    if (battle.status !== "active") return null;
    const now = ctx.now();
    for (let r = 1; r <= BATTLE_ROUNDS; r++) {
      await ensureRound(tx, battle, r);
      await closeMissing(tx, battle, r, now);
    }
    const scored = await scoreRounds(tx, battle, BATTLE_ROUNDS);
    const done = await finish(ctx, tx, fx, battle, scored.outcomes, scored.s1, scored.s2);
    return { battle, ...done };
  });
  if (res) await afterFinish(ctx, fx, res.battle, res.players, res.winnerId);
}

// ---------------------------------------------------------------------------
// Duel en direct : manches cadencées par le serveur (Socket.IO)
// ---------------------------------------------------------------------------

/**
 * Reprise d'un duel en direct interrompu (redémarrage du serveur) : la manche en cours est rejouée
 * de zéro, pour les deux joueurs. Sa question a pu être vue (et cherchée pendant la coupure) : elle est
 * régénérée avec une nouvelle graine, et un autre type de question quand c'est possible.
 */
export async function restartLiveRound(ctx: Ctx, battleId: number, round: number) {
  await ctx.db.transaction(async (tx) => {
    const battle = await lockBattle(tx, battleId);
    if (battle.status !== "active" || round < 1 || round > BATTLE_ROUNDS) return;
    // Réponses de la manche, données ou non : elles portaient sur l'ancienne question.
    await tx
      .delete(schema.battleAnswers)
      .where(and(eq(schema.battleAnswers.battleId, battleId), eq(schema.battleAnswers.round, round)));
    const [seen] = await tx
      .select()
      .from(schema.battleRounds)
      .where(and(eq(schema.battleRounds.battleId, battleId), eq(schema.battleRounds.round, round)));
    if (!seen) return;
    const question = await buildQuestion(
      tx,
      battle,
      round,
      `${battle.seed}:${randomBytes(8).toString("hex")}`,
      seen.question as Question,
    );
    await tx
      .update(schema.battleRounds)
      .set({ question })
      .where(and(eq(schema.battleRounds.battleId, battleId), eq(schema.battleRounds.round, round)));
  });
}

interface LiveState {
  round: number;
  startedAt: Date;
  timer: ReturnType<typeof setTimeout> | null;
}

// ponytail: état en mémoire d'un seul processus API ; plusieurs instances demanderaient un verrou partagé (pg-boss / advisory lock).
const live = (() => {
  const states = new Map<number, LiveState>();
  /** Joueurs présents sur l'écran du duel (`battle:join`) : le direct ne démarre qu'avec les deux. */
  const ready = new Map<number, Set<string>>();

  function stop(battleId: number) {
    const s = states.get(battleId);
    if (s?.timer) clearTimeout(s.timer);
    states.delete(battleId);
    ready.delete(battleId);
  }

  /** Exécute une étape du moteur : une erreur termine le duel proprement au lieu de le laisser bloqué. */
  function run(ctx: Ctx, battleId: number, step: () => Promise<void>) {
    step().catch(async (err: unknown) => {
      ctx.log.error({ err, battleId }, "duel en direct");
      stop(battleId);
      await forceFinish(ctx, battleId).catch((e: unknown) => ctx.log.error({ err: e, battleId }, "fin forcée du duel"));
    });
  }

  async function startRound(ctx: Ctx, battleId: number, round: number) {
    const [battle] = await ctx.db.select().from(b).where(eq(b.id, battleId));
    if (!battle || battle.status !== "active") return stop(battleId);
    // La question est générée avant le départ du chrono : les deux joueurs ont le même temps.
    await ctx.db.transaction((tx) => ensureRound(tx, battle, round));
    const state: LiveState = { round, startedAt: ctx.now(), timer: null };
    states.set(battleId, state);
    state.timer = setTimeout(
      () => run(ctx, battleId, () => resolveRound(ctx, battleId, round)),
      QUESTION_TIME_MS + ANSWER_GRACE_MS,
    );
    await Promise.all(
      [battle.challengerId, battle.opponentId].map(async (userId) => {
        try {
          ctx.rt.toUser(userId, "battle:question", await serveQuestion(ctx, userId, battleId, round));
        } catch (err) {
          ctx.log.warn({ err, battleId }, "question en direct");
        }
      }),
    );
  }

  /** Résout la manche (tout le monde a répondu, ou le temps est écoulé) et enchaîne. */
  async function resolveRound(ctx: Ctx, battleId: number, round: number) {
    const state = states.get(battleId);
    if (!state || state.round !== round) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.round = 0; // plus de réponse acceptée pour cette manche
    const fx = new Effects();
    const res = await ctx.db.transaction(async (tx) => {
      const battle = await lockBattle(tx, battleId);
      if (battle.status !== "active") return null;
      await closeMissing(tx, battle, round, ctx.now());
      const scored = await scoreRounds(tx, battle, round);
      const answers = await tx
        .select()
        .from(schema.battleAnswers)
        .where(and(eq(schema.battleAnswers.battleId, battleId), eq(schema.battleAnswers.round, round)));
      const question = await ensureRound(tx, battle, round);
      const done = scored.over ? await finish(ctx, tx, fx, battle, scored.outcomes, scored.s1, scored.s2) : null;
      return { battle, scored, answers, question, done };
    });
    if (!res) return stop(battleId);
    const last = res.scored.outcomes.find((o) => o.round === round);
    for (const userId of [res.battle.challengerId, res.battle.opponentId]) {
      const isC = userId === res.battle.challengerId;
      const mine = res.answers.find((a) => a.userId === userId);
      const theirs = res.answers.find((a) => a.userId !== userId);
      const payload: BattleRoundResultDTO = {
        battleId,
        round,
        correctIndex: res.question.answer,
        yourChoice: mine?.choice ?? null,
        yourPower: Math.round(mine?.power ?? 0),
        theirPower: Math.round(theirs?.power ?? 0),
        winnerId: last?.winner === 1 ? res.battle.challengerId : last?.winner === 2 ? res.battle.opponentId : null,
        score: { you: isC ? res.scored.s1 : res.scored.s2, them: isC ? res.scored.s2 : res.scored.s1 },
        finished: res.scored.over,
      };
      ctx.rt.toUser(userId, "battle:round", payload);
    }
    if (res.done) {
      stop(battleId);
      await afterFinish(ctx, fx, res.battle, res.done.players, res.done.winnerId);
    } else {
      setTimeout(() => run(ctx, battleId, () => startRound(ctx, battleId, round + 1)), LIVE_PAUSE_MS);
    }
  }

  /**
   * Démarre (ou reprend après un redémarrage du serveur) quand les deux joueurs sont sur l'écran du duel :
   * on repart de la première manche incomplète, avec un chrono neuf.
   */
  async function maybeStart(ctx: Ctx, battleId: number) {
    if (states.has(battleId)) return;
    const [battle] = await ctx.db.select().from(b).where(eq(b.id, battleId));
    if (!battle || battle.status !== "active" || battle.mode !== "live") return;
    const here = ready.get(battleId);
    const present = (id: string) => here?.has(id) && ctx.rt.isOnline(id);
    if (!present(battle.challengerId) || !present(battle.opponentId) || states.has(battleId)) return;
    const scored = await scoreRounds(ctx.db, battle, BATTLE_ROUNDS);
    const next = scored.outcomes.length + 1;
    states.set(battleId, { round: 0, startedAt: ctx.now(), timer: null });
    await restartLiveRound(ctx, battleId, next);
    setTimeout(() => run(ctx, battleId, () => startRound(ctx, battleId, next)), 1_500);
  }

  return {
    currentRound: (battleId: number) => states.get(battleId)?.round ?? 0,
    roundStart: (battleId: number, round: number) => {
      const s = states.get(battleId);
      return s && s.round === round ? s.startedAt : null;
    },
    maybeStart: (ctx: Ctx, battleId: number) => run(ctx, battleId, () => maybeStart(ctx, battleId)),
    /** Un joueur ouvre l'écran du duel (ou se reconnecte) : renvoie la question en cours, le chrono continue. */
    join(ctx: Ctx, userId: string, battleId: number) {
      const set = ready.get(battleId) ?? new Set<string>();
      set.add(userId);
      ready.set(battleId, set);
      const state = states.get(battleId);
      if (state && state.round > 0) {
        serveQuestion(ctx, userId, battleId, state.round)
          .then((q) => ctx.rt.toUser(userId, "battle:question", q))
          .catch(() => {}); // manche en cours de résolution
      } else if (!state) this.maybeStart(ctx, battleId);
    },
    async onAnswer(ctx: Ctx, battleId: number, round: number) {
      const state = states.get(battleId);
      if (!state || state.round !== round) return;
      const [row] = await ctx.db.execute<{ n: number }>(sql`
        select count(*)::int as n from battle_answers where battle_id = ${battleId} and round = ${round} and answered_at is not null
      `);
      if ((row?.n ?? 0) >= 2) run(ctx, battleId, () => resolveRound(ctx, battleId, round));
    },
    isRunning: (battleId: number) => states.has(battleId),
  };
})();

export const liveBattles = live;

/** Rattrapage : défis expirés, duels asynchrones trop vieux, duels en direct interrompus. */
export async function sweepBattles(ctx: Ctx) {
  const now = ctx.now().getTime();
  const rows = await ctx.db
    .select()
    .from(b)
    .where(inArray(b.status, ["pending", "active"]));
  for (const battle of rows) {
    try {
      const age = now - (battle.startedAt ?? battle.createdAt).getTime();
      if (battle.status === "pending" && now - battle.createdAt.getTime() > CHALLENGE_TTL_MS) {
        await ctx.db
          .update(b)
          .set({ status: "cancelled", finishedAt: ctx.now() })
          .where(and(eq(b.id, battle.id), eq(b.status, "pending")));
      } else if (battle.status === "active" && battle.mode === "async" && age > ASYNC_BATTLE_TTL_MS) {
        await forceFinish(ctx, battle.id);
      } else if (
        battle.status === "active" &&
        battle.mode === "live" &&
        !live.isRunning(battle.id) &&
        age > LIVE_STALE_MS
      ) {
        // Jamais commencé (un joueur n'est pas venu) : annulé sans récompense ; interrompu en cours : terminé.
        const [played] = await ctx.db.execute<{ n: number }>(
          sql`select count(*)::int as n from battle_answers where battle_id = ${battle.id} and answered_at is not null`,
        );
        if ((played?.n ?? 0) === 0) {
          await ctx.db
            .update(b)
            .set({ status: "cancelled", finishedAt: ctx.now() })
            .where(and(eq(b.id, battle.id), eq(b.status, "active")));
          ctx.rt.toUser(battle.challengerId, "battle:update", { battleId: battle.id });
          ctx.rt.toUser(battle.opponentId, "battle:update", { battleId: battle.id });
        } else await forceFinish(ctx, battle.id);
      }
    } catch (err) {
      ctx.log.error({ err, battleId: battle.id }, "rattrapage de duel");
    }
  }
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

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
  const progress = rows.length
    ? await ctx.db
        .select({ battleId: schema.battleAnswers.battleId, n: sql<number>`count(*)::int` })
        .from(schema.battleAnswers)
        .where(
          and(
            inArray(
              schema.battleAnswers.battleId,
              rows.map((r) => r.id),
            ),
            eq(schema.battleAnswers.userId, userId),
            sql`${schema.battleAnswers.answeredAt} is not null`,
          ),
        )
        .groupBy(schema.battleAnswers.battleId)
    : [];
  const doneBy = new Map(progress.map((p) => [p.battleId, p.n]));
  return rows.map((r) => {
    const isChallenger = r.challengerId === userId;
    const otherId = isChallenger ? r.opponentId : r.challengerId;
    const other = userBy.get(otherId);
    return {
      id: r.id,
      mode: r.mode,
      status: r.status,
      isChallenger,
      opponent: { id: otherId, name: other?.name ?? "?", username: other?.username ?? "" },
      score: {
        you: isChallenger ? r.challengerScore : r.opponentScore,
        them: isChallenger ? r.opponentScore : r.challengerScore,
      },
      result: r.status !== "finished" ? null : r.winnerId === null ? "draw" : r.winnerId === userId ? "win" : "loss",
      eloDelta: isChallenger ? r.challengerEloDelta : r.opponentEloDelta,
      roundsPlayed: doneBy.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    };
  });
}

/** Détail d'un duel : manches terminées (réponses révélées) et decks (celui de l'adversaire à la fin). */
export async function battleDetail(ctx: Ctx, userId: string, battleId: number) {
  const [battle] = await ctx.db.select().from(b).where(eq(b.id, battleId));
  if (!battle) throw notFound("Ce duel n'existe pas.");
  const side = sideOf(battle, userId);
  const all = await decks(ctx.db, battleId);
  const finished = battle.status === "finished";
  const myDeck = all.filter((d) => d.userId === userId);
  const theirDeck = finished ? all.filter((d) => d.userId !== userId) : [];
  const cards = await instancesByIds(
    ctx.db,
    [...myDeck, ...theirDeck].map((d) => d.instanceId),
    userId,
  );
  const cardOf = (d: DeckRow) => ({
    ...(cards.find((c) => c.instanceId === d.instanceId) ?? { title: "?", thumbUrl: null }),
    slot: d.slot,
    atk: d.atk,
    def: d.def,
    rarity: d.rarity,
    cardId: d.cardId,
    season: d.season,
    instanceId: d.instanceId,
  });
  const answers = await ctx.db.select().from(schema.battleAnswers).where(eq(schema.battleAnswers.battleId, battleId));
  const rounds = await ctx.db
    .select()
    .from(schema.battleRounds)
    .where(eq(schema.battleRounds.battleId, battleId))
    .orderBy(asc(schema.battleRounds.round));
  const otherId = side === "challenger" ? battle.opponentId : battle.challengerId;
  const names = await ctx.db
    .select({
      id: schema.user.id,
      username: schema.user.username,
      name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})`,
    })
    .from(schema.user)
    .where(eq(schema.user.id, otherId));
  const myAnswered = answers.filter((a) => a.userId === userId && a.answeredAt).map((a) => a.round);
  return {
    id: battle.id,
    mode: battle.mode,
    status: battle.status,
    isChallenger: side === "challenger",
    opponent: { id: otherId, name: names[0]?.name ?? "?", username: names[0]?.username ?? "" },
    winnerId: battle.winnerId,
    score:
      side === "challenger"
        ? { you: battle.challengerScore, them: battle.opponentScore }
        : { you: battle.opponentScore, them: battle.challengerScore },
    eloDelta: side === "challenger" ? battle.challengerEloDelta : battle.opponentEloDelta,
    nextRound: battle.status === "active" ? (myAnswered.length ? Math.max(...myAnswered) + 1 : 1) : null,
    liveRound: battle.mode === "live" ? live.currentRound(battleId) : null,
    myDeck: myDeck.map(cardOf),
    theirDeck: theirDeck.map(cardOf),
    // Une manche n'est détaillée qu'une fois jouée par le joueur (et, pour l'adversaire, une fois le duel fini).
    rounds: rounds
      .filter((r) => myAnswered.includes(r.round))
      .map((r) => {
        const q = r.question as Question;
        const mine = answers.find((a) => a.round === r.round && a.userId === userId);
        const theirs = finished ? answers.find((a) => a.round === r.round && a.userId !== userId) : undefined;
        return {
          round: r.round,
          type: q.type,
          prompt: q.prompt,
          choices: q.choices,
          correctIndex: q.answer,
          yourChoice: mine?.choice ?? null,
          yourPower: Math.round(mine?.power ?? 0),
          theirPower: theirs ? Math.round(theirs.power ?? 0) : null,
          winnerId: finished ? r.winnerId : null,
        };
      }),
  };
}
