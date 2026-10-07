import { and, desc, eq, schema, sql } from "@palacards/db";
import {
  ACHIEVEMENTS,
  achievementProgress,
  LEGENDARY_BOARD_RARITY,
  LUCK_MIN_PACKS,
  applyStatUpdates,
  newlyUnlocked,
  passProgress,
  passReward,
  questProgress,
  STAT_KEYS,
  statUpdates,
  xpForEvent,
  type AchievementDef,
  type GameEvent,
  type QuestKind,
  type StatKey,
  type TitleBoard,
  type TitleRef,
} from "@palacards/game";
import type { Ctx } from "../context.js";
import {
  activeSeason,
  lockPlayer,
  logMovement,
  movePw,
  packState,
  pushWallet,
  type DbOrTx,
  type Player,
} from "./players.js";
import { afterCommit, Effects } from "./notifications.js";
import { bannersOf } from "./banners.js";
import { battleRewarded, onBattleFinished } from "./battles.js";
import { collectionScoresSql, statusNoteOf } from "./profiles.js";
import { ensureQuests, type QuestRow } from "./quests.js";
import { displayedTitles } from "./titles.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

let hooksRegistered = false;
/** Branche les succès sur la fin des duels (une fois par processus, appelé au démarrage de l'app). */
export function registerProgressionHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onBattleFinished(async (ctx, battle, winnerId) => {
    for (const userId of [battle.challengerId, battle.opponentId]) {
      // Anti-farm : seules les victoires récompensées en PW (quota par paire et par jour) comptent pour les succès.
      const won = winnerId === userId && (await battleRewarded(ctx.db, userId, battle.id));
      const [p] = await ctx.db
        .select({ elo: schema.players.elo })
        .from(schema.players)
        .where(eq(schema.players.userId, userId));
      void emit(ctx, userId, { type: "battle_finished", won, winStreak: await winStreak(ctx.db, userId), elo: p?.elo });
    }
  });
}

// ---------------------------------------------------------------------------
// Progression : un événement → statistiques, quêtes, XP du passe, succès
// ---------------------------------------------------------------------------

/** Statistiques d'un joueur. */
async function loadStats(db: DbOrTx, userId: string): Promise<Map<StatKey, number>> {
  const rows = await db.select().from(schema.playerStats).where(eq(schema.playerStats.userId, userId));
  return new Map(rows.map((r) => [r.key as StatKey, r.value]));
}

async function saveStats(tx: Tx, userId: string, changed: Map<StatKey, number>) {
  if (!changed.size) return;
  await tx
    .insert(schema.playerStats)
    .values([...changed].map(([key, value]) => ({ userId, key, value })))
    .onConflictDoUpdate({
      target: [schema.playerStats.userId, schema.playerStats.key],
      set: { value: sql`greatest(${schema.playerStats.value}, excluded.value)` },
    });
}

/** Récompenses accumulées pendant une progression (versées en fin de transaction). */
class Rewards {
  pw = 0;
  packs = 0;
  xp = 0;
  add(r: { pw?: number; packs?: number; xp?: number }) {
    this.pw += r.pw ?? 0;
    this.packs += r.packs ?? 0;
    this.xp += r.xp ?? 0;
  }
}

async function addBonusPacks(
  tx: Tx,
  player: Player,
  packs: number,
  reason: "achievement" | "quest" | "season_pass",
  ref: string,
) {
  if (!packs) return;
  const bonusPacks = player.bonusPacks + packs;
  await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, player.userId));
  await logMovement(tx, player.userId, "bonus_pack", packs, bonusPacks, reason, ref);
  player.bonusPacks = bonusPacks;
}

/**
 * XP du passe de saison : l'XP d'une autre saison repart de 0. Chaque niveau franchi est récompensé une
 * seule fois (PW et paquets bonus dans le ledger) ; renvoie les niveaux gagnés.
 */
async function grantXp(tx: Tx, player: Player, season: number, xp: number, fx: Effects): Promise<number[]> {
  const fresh = player.passSeason !== season;
  const before = fresh ? 0 : player.seasonXp;
  const rewarded = fresh ? 0 : player.passRewarded;
  if (xp <= 0 && !fresh) return [];
  const total = before + Math.max(0, xp);
  const { level } = passProgress(total);
  const gained: number[] = [];
  for (let n = rewarded + 1; n <= level; n++) gained.push(n);
  await tx
    .update(schema.players)
    .set({ seasonXp: total, passSeason: season, passRewarded: Math.max(rewarded, level) })
    .where(eq(schema.players.userId, player.userId));
  player.seasonXp = total;
  player.passSeason = season;
  player.passRewarded = Math.max(rewarded, level);
  for (const n of gained) {
    const r = passReward(n);
    if (r.pw) await movePw(tx, player, r.pw, "season_pass", `s${season}:${n}`);
    await addBonusPacks(tx, player, r.packs, "season_pass", `s${season}:${n}`);
  }
  if (gained.length) {
    const last = gained.at(-1)!;
    const total = gained.map(passReward).reduce((a, r) => ({ pw: a.pw + r.pw, packs: a.packs + r.packs }), {
      pw: 0,
      packs: 0,
    });
    await fx.notify(tx, player.userId, "pass_level", { level: last, levels: gained.length, reward: total });
  }
  return gained;
}

/** Fait avancer les quêtes ouvertes ; renvoie les quêtes terminées par cet événement. */
async function advanceQuests(tx: Tx, quests: QuestRow[], event: GameEvent, now: Date): Promise<QuestRow[]> {
  const done: QuestRow[] = [];
  for (const q of quests) {
    if (q.completedAt) continue;
    const inc = questProgress(q.kind as QuestKind, event);
    if (inc <= 0) continue;
    const progress = Math.min(q.target, q.progress + inc);
    const completedAt = progress >= q.target ? now : null;
    await tx
      .update(schema.playerQuests)
      .set({ progress, completedAt })
      .where(
        and(
          eq(schema.playerQuests.userId, q.userId),
          eq(schema.playerQuests.period, q.period),
          eq(schema.playerQuests.periodStart, q.periodStart),
          eq(schema.playerQuests.slot, q.slot),
        ),
      );
    q.progress = progress;
    q.completedAt = completedAt;
    if (completedAt) done.push(q);
  }
  return done;
}

/** Débloque les succès atteints (récompenses et notifications) ; renvoie les succès débloqués. */
async function unlockAchievements(
  tx: Tx,
  ctx: Ctx,
  player: Player,
  stats: Map<StatKey, number>,
  rewards: Rewards,
  fx: Effects | null,
): Promise<AchievementDef[]> {
  const rows = await tx
    .select({ key: schema.achievementsProgress.achievementKey, unlockedAt: schema.achievementsProgress.unlockedAt })
    .from(schema.achievementsProgress)
    .where(eq(schema.achievementsProgress.userId, player.userId));
  const unlocked = new Set(rows.filter((r) => r.unlockedAt).map((r) => r.key));
  const fresh = newlyUnlocked(stats, unlocked);
  for (const def of fresh) {
    await tx
      .insert(schema.achievementsProgress)
      .values({ userId: player.userId, achievementKey: def.key, progress: def.target, unlockedAt: ctx.now() })
      .onConflictDoUpdate({
        target: [schema.achievementsProgress.userId, schema.achievementsProgress.achievementKey],
        set: { progress: def.target, unlockedAt: ctx.now() },
      });
    if (def.reward.pw) await movePw(tx, player, def.reward.pw, "achievement", def.key);
    await addBonusPacks(tx, player, def.reward.packs, "achievement", def.key);
    rewards.add(def.reward);
    if (fx) await fx.notify(tx, player.userId, "achievement", { key: def.key, name: def.name, reward: def.reward });
  }
  return fresh;
}

/**
 * Applique un événement du jeu pour un joueur, en une transaction (joueur verrouillé : les événements d'un
 * même joueur sont sérialisés) : statistiques, quêtes du jour et de la semaine, XP et niveaux du passe,
 * succès. Toutes les récompenses passent par le ledger ; chaque palier n'est payé qu'une fois.
 */
export async function recordEvent(ctx: Ctx, userId: string, event: GameEvent) {
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const player = await lockPlayer(tx, userId);
    const season = await activeSeason(tx);
    const now = ctx.now();
    const stats = await loadStats(tx, userId);
    const changed = new Map<StatKey, number>();
    const merge = (e: GameEvent) => {
      for (const [k, v] of applyStatUpdates(stats, statUpdates(e))) changed.set(k, v);
    };
    merge(event);

    // Quêtes : l'événement, puis la complétion des quêtes du jour (qui fait avancer celle de la semaine).
    const quests = await ensureQuests(tx, userId, now);
    let xp = xpForEvent(event);
    let pw = 0;
    const completed: QuestRow[] = [];
    let queue: GameEvent[] = [event];
    while (queue.length) {
      const next: GameEvent[] = [];
      for (const e of queue) {
        for (const q of await advanceQuests(tx, quests, e, now)) {
          completed.push(q);
          xp += q.rewardXp;
          pw += q.rewardPw;
          const done: GameEvent = { type: "quest_completed", period: q.period };
          merge(done);
          next.push(done);
        }
      }
      queue = next;
    }
    if (pw)
      await movePw(tx, player, pw, "quest", completed.map((q) => `${q.period}:${q.periodStart}:${q.slot}`).join(","));
    for (const q of completed)
      await fx.notify(tx, userId, "quest_completed", {
        kind: q.kind,
        target: q.target,
        period: q.period,
        reward: { pw: q.rewardPw, xp: q.rewardXp },
      });

    const levels = await grantXp(tx, player, season, xp, fx);
    if (levels.length) merge({ type: "pass_level", level: levels.at(-1)! });

    const rewards = new Rewards();
    const unlocked = await unlockAchievements(tx, ctx, player, stats, rewards, fx);
    await saveStats(tx, userId, changed);
    return {
      player,
      paid: pw > 0 || levels.length > 0 || unlocked.length > 0,
      progressed: completed.length > 0 || xp > 0 || unlocked.length > 0,
    };
  });
  await afterCommit(ctx, async () => {
    if (res.paid) {
      pushWallet(ctx, res.player);
      ctx.rt.toUser(userId, "packs:update", packState(res.player, ctx.now()));
    }
    if (res.progressed) ctx.rt.toUser(userId, "progress:update", {});
    await fx.flush(ctx);
  });
}

/**
 * Fait progresser le joueur après une action, sans jamais la faire échouer (erreurs journalisées).
 * `"collection"` recalcule l'état de la collection (articles uniques, Légendaires, part des UR, initiales).
 */
export function emit(ctx: Ctx, userId: string, ...events: (GameEvent | "collection")[]) {
  const task = (async () => {
    for (const e of events) {
      try {
        await recordEvent(ctx, userId, e === "collection" ? await collectionEvent(ctx.db, userId) : e);
      } catch (err) {
        ctx.log.error({ err, event: e === "collection" ? e : e.type }, "progression");
      }
    }
  })();
  pending.add(task);
  void task.finally(() => pending.delete(task));
  return task;
}

const pending = new Set<Promise<void>>();
/** Attend la fin des progressions en cours de traitement (arrêt propre du serveur, tests). */
export async function progressionIdle() {
  while (pending.size) await Promise.allSettled([...pending]);
}

/**
 * Événement « collection » : articles uniques, Légendaires différentes, part des UR de la saison, initiales.
 * Anti-farm : seuls comptent les exemplaires que le joueur a tirés lui-même et toujours détenus
 * (`source` = `pack`, `upgrade`, `wheel` ou `boss` ; un transfert par échange ou vente la réécrit en `trade` /
 * `market`, un don admin vaut `admin`). Sinon des amis se prêteraient gratuitement leurs cartes pour débloquer
 * les succès de collection chacun à leur tour.
 */
export async function collectionEvent(db: DbOrTx, userId: string): Promise<GameEvent> {
  const season = await activeSeason(db);
  const [row] = await db.execute<{
    unique_cards: number;
    unique_l: number;
    unique_ur: number;
    total_ur: number;
    initials: number;
  }>(sql`
    with pulled as (
      select i.card_id, i.rarity, i.season from card_instances i
      where i.owner_id = ${userId} and i.source in ('pack', 'upgrade', 'wheel', 'boss')
    )
    select
      (select count(distinct card_id)::int from pulled) as unique_cards,
      (select count(distinct card_id)::int from pulled where rarity = 'L') as unique_l,
      (select count(distinct card_id)::int from pulled where rarity = 'UR' and season = ${season}) as unique_ur,
      (select count(*)::int from cards where season = ${season} and rarity = 'UR') as total_ur,
      (select count(distinct upper(left(f_unaccent(c.title), 1)))::int from pulled p
         join cards c on c.season = p.season and c.id = p.card_id
         where upper(left(f_unaccent(c.title), 1)) between 'A' and 'Z') as initials
  `);
  return {
    type: "collection",
    uniqueCards: row?.unique_cards ?? 0,
    uniqueLegendary: row?.unique_l ?? 0,
    uniqueUR: row?.unique_ur ?? 0,
    totalUR: row?.total_ur ?? 0,
    initials: row?.initials ?? 0,
  };
}

const rewardedSql = (userId: string) =>
  sql`exists (select 1 from ledger l where l.user_id = ${userId} and l.reason = 'battle' and l.ref_id = ${schema.battles.id}::text)`;

/** Série de victoires en cours, sur les seuls duels récompensés (du plus récent au plus ancien). */
export async function winStreak(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ winnerId: schema.battles.winnerId })
    .from(schema.battles)
    .where(
      and(
        eq(schema.battles.status, "finished"),
        sql`(${schema.battles.challengerId} = ${userId} or ${schema.battles.opponentId} = ${userId})`,
        rewardedSql(userId),
      ),
    )
    .orderBy(desc(schema.battles.finishedAt))
    .limit(50);
  let n = 0;
  for (const r of rows) {
    if (r.winnerId !== userId) break;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Rattrapage : statistiques recalculées depuis l'historique (une fois par version)
// ---------------------------------------------------------------------------

/** À augmenter quand le rattrapage sait recalculer une statistique de plus. */
export const STATS_VERSION = 1;

/**
 * Statistiques déductibles de l'historique (ledger, enchères, échanges, duels, collection). Les cartes
 * recyclées ou vendues ne disent plus leur rareté : les tirages par rareté sont des minimums.
 */
async function historicalStats(db: DbOrTx, userId: string): Promise<Map<StatKey, number>> {
  const [h] = await db.execute<Record<string, number | string | null>>(sql`
    select
      (select count(*) from ledger where user_id = ${userId} and kind = 'card' and reason = 'pack_open') as packs_opened,
      (select count(*) from ledger where user_id = ${userId} and kind = 'theme_pack' and reason = 'pack_open')
        + (select count(*) from ledger where user_id = ${userId} and kind = 'pw' and reason = 'theme_pack' and delta < 0) as theme_packs_opened,
      (select count(*) from card_instances where owner_id = ${userId} and source in ('pack', 'wheel', 'upgrade') and rarity = 'SR') as pulled_sr,
      (select count(*) from card_instances where owner_id = ${userId} and source in ('pack', 'wheel', 'upgrade') and rarity = 'UR') as pulled_ur,
      (select count(*) from card_instances where owner_id = ${userId} and source in ('pack', 'wheel', 'upgrade') and rarity = 'L') as pulled_l,
      (select count(*) from auctions where seller_id = ${userId} and status = 'sold') as sales,
      (select coalesce(max(current_bid), 0) from auctions where seller_id = ${userId} and status = 'sold') as best_sale,
      (select count(*) from auctions a where a.seller_id = ${userId} and a.status = 'sold' and a.current_bid > 1000
         and (select count(distinct b.bidder_id) from bids b where b.auction_id = a.id) >= 2) as big_sales,
      (select count(*) from auctions where current_bidder_id = ${userId} and status = 'sold') as purchases,
      (select count(*) from trades where status = 'accepted' and (from_id = ${userId} or to_id = ${userId})) as trades,
      (select count(*) from battles where status = 'finished' and (challenger_id = ${userId} or opponent_id = ${userId})) as battles_played,
      (select count(*) from battles bt where bt.status = 'finished' and bt.winner_id = ${userId}
         and exists (select 1 from ledger l where l.user_id = ${userId} and l.reason = 'battle' and l.ref_id = bt.id::text)) as battles_won,
      (select greatest(p.elo_peak, p.elo, coalesce((select max(a.elo) from season_archives a where a.user_id = ${userId}), 0))
         from players p where p.user_id = ${userId}) as elo_peak,
      (select coalesce(max(level), 0) from card_instances where owner_id = ${userId}) as card_level_max,
      (select count(*) from ledger where user_id = ${userId} and kind = 'card' and reason = 'fusion') as fusions,
      (select count(*) from guild_members where user_id = ${userId}) as guild_joined,
      (select count(*) from friendships where status = 'accepted' and (user_a = ${userId} or user_b = ${userId})) as friends,
      (select login_streak from players where user_id = ${userId}) as login_streak_max,
      (select count(distinct ref_id) from ledger where user_id = ${userId} and reason = 'wheel') as wheel_spins,
      (select coalesce(sum(-delta), 0) from ledger where user_id = ${userId} and kind = 'card' and reason = 'recycle' and delta < 0) as recycled,
      (select count(*) from ledger where user_id = ${userId} and kind = 'card' and reason = 'upgrade' and delta < 0) as upgrades,
      (select count(*) from ledger where user_id = ${userId} and kind = 'card' and reason = 'upgrade' and delta > 0) as upgrades_won
  `);
  const out = new Map<StatKey, number>();
  for (const key of STAT_KEYS) {
    const v = h?.[key];
    if (v !== undefined && v !== null && Number(v) > 0) out.set(key, Number(v));
  }
  // Meilleure série : duels récompensés, du plus ancien au plus récent.
  const battles = await db.execute<{ winner_id: string | null }>(sql`
    select bt.winner_id from battles bt
    where bt.status = 'finished' and (bt.challenger_id = ${userId} or bt.opponent_id = ${userId})
      and exists (select 1 from ledger l where l.user_id = ${userId} and l.reason = 'battle' and l.ref_id = bt.id::text)
    order by bt.finished_at
  `);
  let streak = 0;
  let best = 0;
  for (const b of battles) {
    streak = b.winner_id === userId ? streak + 1 : 0;
    best = Math.max(best, streak);
  }
  if (best) out.set("best_win_streak", best);
  // Succès de la V1 déjà en cours (progression plafonnée à leur objectif) : des minimums de plus.
  const legacy: Record<string, StatKey> = {
    first_sr: "pulled_sr",
    first_ur: "pulled_ur",
    first_l: "pulled_l",
    login_7: "login_streak_max",
    streak_5: "best_win_streak",
    big_sale: "big_sales",
  };
  const rows = await db
    .select()
    .from(schema.achievementsProgress)
    .where(eq(schema.achievementsProgress.userId, userId));
  for (const r of rows) {
    const stat = legacy[r.achievementKey];
    if (stat) out.set(stat, Math.max(out.get(stat) ?? 0, r.progress));
  }
  return out;
}

/**
 * Rattrapage des succès à paliers pour un joueur (à sa prochaine visite) : ses statistiques sont recalculées
 * depuis l'historique, et tous les paliers déjà atteints sont débloqués et payés d'un coup, avec une seule
 * notification récapitulative. Idempotent : la version est relue sous verrou du joueur.
 */
export async function backfillStats(ctx: Ctx, userId: string) {
  const fx = new Effects();
  const history = await historicalStats(ctx.db, userId);
  const collection = await collectionEvent(ctx.db, userId);
  const res = await ctx.db.transaction(async (tx) => {
    const player = await lockPlayer(tx, userId);
    if (player.statsVersion >= STATS_VERSION) return null;
    const stats = await loadStats(tx, userId);
    const changed = new Map<StatKey, number>();
    for (const [k, v] of history) if (v > (stats.get(k) ?? 0)) changed.set(k, v);
    for (const [k, v] of applyStatUpdates(new Map(stats), statUpdates(collection)))
      if (v > (changed.get(k) ?? stats.get(k) ?? 0)) changed.set(k, v);
    for (const [k, v] of changed) stats.set(k, v);
    await saveStats(tx, userId, changed);
    const rewards = new Rewards();
    const unlocked = await unlockAchievements(tx, ctx, player, stats, rewards, null);
    await tx.update(schema.players).set({ statsVersion: STATS_VERSION }).where(eq(schema.players.userId, userId));
    if (unlocked.length)
      await fx.notify(tx, userId, "achievement_backfill", {
        count: unlocked.length,
        reward: { pw: rewards.pw, packs: rewards.packs },
        names: unlocked.slice(0, 5).map((a) => a.name),
      });
    return { player, unlocked: unlocked.length };
  });
  if (!res) return { unlocked: 0 };
  await afterCommit(ctx, async () => {
    if (res.unlocked) {
      pushWallet(ctx, res.player);
      ctx.rt.toUser(userId, "packs:update", packState(res.player, ctx.now()));
      ctx.rt.toUser(userId, "progress:update", {});
    }
    await fx.flush(ctx);
  });
  return { unlocked: res.unlocked };
}

const backfilling = new Set<string>();
/** Lance le rattrapage en arrière-plan si la version du joueur est en retard (une fois par processus et par joueur). */
export function ensureBackfill(ctx: Ctx, player: Pick<Player, "userId" | "statsVersion">) {
  if (player.statsVersion >= STATS_VERSION || backfilling.has(player.userId)) return;
  backfilling.add(player.userId);
  const task = backfillStats(ctx, player.userId)
    .catch((err) => ctx.log.error({ err }, "rattrapage des succès"))
    .then(() => undefined)
    .finally(() => backfilling.delete(player.userId));
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

// ---------------------------------------------------------------------------
// Lecture : succès, passe
// ---------------------------------------------------------------------------

export async function listAchievements(ctx: Ctx, userId: string) {
  const [rows, stats] = await Promise.all([
    ctx.db.select().from(schema.achievementsProgress).where(eq(schema.achievementsProgress.userId, userId)),
    loadStats(ctx.db, userId),
  ]);
  const by = new Map(rows.map((r) => [r.achievementKey, r]));
  return ACHIEVEMENTS.map((a) => {
    const unlockedAt = by.get(a.key)?.unlockedAt?.toISOString() ?? null;
    const hidden = !!a.secret && !unlockedAt;
    return {
      key: a.key,
      family: a.family,
      tier: a.tier,
      secret: !!a.secret,
      name: hidden ? "Succès secret" : a.name,
      description: hidden ? "Continue à jouer pour le découvrir." : a.description,
      target: a.target,
      reward: a.reward,
      progress: unlockedAt ? a.target : hidden ? 0 : achievementProgress(a, stats),
      unlockedAt,
    };
  });
}

/** État du passe de saison d'un joueur (l'XP d'une saison passée ne compte plus). */
export function passState(player: Pick<Player, "seasonXp" | "passSeason">, season: number) {
  const xp = player.passSeason === season ? player.seasonXp : 0;
  return { season, xp, ...passProgress(xp) };
}

// ---------------------------------------------------------------------------
// Classements
// ---------------------------------------------------------------------------

/** Les classements, qui donnent chacun un titre en fin de saison. */
export type Board = TitleBoard;

interface Row {
  id: string;
  name: string;
  username: string | null;
  /** Photo ou emoji du joueur ; emblème pour une guilde. */
  avatar: string | null;
  value: number;
  extra?: string;
  /** Classement « Chance » : paquets mesurés. */
  packs?: number;
  /** Badge « Créateur » (compte admin du jeu). */
  creator?: boolean;
  /** Titre affiché par le joueur. */
  title?: TitleRef;
  /** Note de statut du joueur. */
  statusNote?: string;
  /** Image de la bannière du joueur (fond de sa ligne) ; absente : pas de bannière ou image pas encore chargée. */
  banner?: { cardId: number; thumbUrl: string };
}

/**
 * Classements : collection (points des articles uniques), légendaires (articles L différents), boosters ouverts, chance (points tirés ÷ points attendus,
 * en %, à partir de LUCK_MIN_PACKS paquets mesurés), Elo, richesse (solde), guildes et niveau du passe.
 * « Saison » : édition en cours et Elo remis à 1 000 ; « tout temps » : toutes éditions, meilleur Elo, archives.
 */
export async function leaderboard(ctx: Ctx, userId: string, board: Board, period: "season" | "all") {
  const season = await activeSeason(ctx.db);
  const rows = await boardRows(ctx.db, board, period, season);
  if (board !== "guilds" && rows.length) {
    const admins = await ctx.db.execute<{ id: string }>(sql`
      select id from "user" where is_admin and id in (${sql.join(
        rows.map((r) => sql`${r.id}`),
        sql`, `,
      )})
    `);
    const ids = new Set(admins.map((a) => a.id));
    const titles = await displayedTitles(
      ctx.db,
      rows.map((r) => r.id),
    );
    const notes = await ctx.db.execute<{
      user_id: string;
      status_note: string | null;
      status_note_at: Date | string | null;
    }>(sql`
      select user_id, status_note, status_note_at from players
      where status_note is not null and user_id in (${sql.join(
        rows.map((r) => sql`${r.id}`),
        sql`, `,
      )})
    `);
    const noteOf = new Map(notes.map((n) => [n.user_id, statusNoteOf(ctx, n)]));
    const banners = await bannersOf(
      ctx.db,
      rows.map((r) => r.id),
    );
    for (const r of rows) {
      const banner = banners.get(r.id);
      if (banner?.thumbUrl) r.banner = { cardId: banner.cardId, thumbUrl: banner.thumbUrl };
      if (ids.has(r.id)) r.creator = true;
      const title = titles.get(r.id);
      if (title) r.title = title;
      const note = noteOf.get(r.id);
      if (note) r.statusNote = note;
    }
  }
  const myGuild =
    board === "guilds"
      ? (
          await ctx.db
            .select({ g: schema.guildMembers.guildId })
            .from(schema.guildMembers)
            .where(eq(schema.guildMembers.userId, userId))
        )[0]?.g
      : undefined;
  return {
    season,
    rows: rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      me: board === "guilds" ? String(myGuild) === r.id : r.id === userId,
    })),
  };
}

/** Les 100 premiers d'un classement, dans l'ordre (relu aussi à la bascule de saison, pour les titres). */
export async function boardRows(db: DbOrTx, board: Board, period: "season" | "all", season: number) {
  let rows: Row[] = [];
  if (board === "collection") {
    const res = await db.execute<{
      owner_id: string;
      score: number;
      username: string;
      name: string;
      avatar: string | null;
    }>(sql`
      select s.owner_id, s.score, u.username, coalesce(u.display_username, u.name) as name, p.avatar
      from (${collectionScoresSql(period === "season" ? season : undefined)}) s join "user" u on u.id = s.owner_id
      left join players p on p.user_id = s.owner_id
      order by s.score desc, u.username limit 100
    `);
    rows = res.map((r) => ({ id: r.owner_id, name: r.name, username: r.username, avatar: r.avatar, value: r.score }));
  } else if (board === "legendary") {
    // Articles légendaires différents possédés (doublons comptés une fois). Égalité : le premier à avoir atteint
    // ce nombre (date d'obtention de sa dernière légendaire nouvelle), puis le pseudo.
    const seasonFilter = period === "season" ? sql`and ci.season = ${season}` : sql``;
    const res = await db.execute<{
      owner_id: string;
      value: number;
      username: string;
      name: string;
      avatar: string | null;
    }>(sql`
      select l.owner_id, l.value, u.username, coalesce(u.display_username, u.name) as name, p.avatar
      from (
        select owner_id, count(*)::int as value, max(got_at) as reached_at from (
          select ci.owner_id, ci.card_id, min(ci.obtained_at) as got_at
          from card_instances ci
          where ci.rarity = ${LEGENDARY_BOARD_RARITY}::rarity ${seasonFilter}
          group by ci.owner_id, ci.card_id
        ) cards group by owner_id
      ) l join "user" u on u.id = l.owner_id left join players p on p.user_id = l.owner_id
      order by l.value desc, l.reached_at, u.username limit 100
    `);
    rows = res.map((r) => ({ id: r.owner_id, name: r.name, username: r.username, avatar: r.avatar, value: r.value }));
  } else if (board === "packs" || board === "luck") {
    const seasonFilter = period === "season" ? sql`where ps.season = ${season}` : sql``;
    const res = await db.execute<{
      user_id: string;
      value: string;
      packs: number;
      username: string;
      name: string;
      avatar: string | null;
    }>(
      board === "packs"
        ? sql`
          select ps.user_id, sum(ps.packs) as value, 0 as packs, u.username, coalesce(u.display_username, u.name) as name,
            p.avatar
          from pack_stats ps join "user" u on u.id = ps.user_id left join players p on p.user_id = ps.user_id
          ${seasonFilter}
          group by ps.user_id, u.username, u.display_username, u.name, p.avatar
          having sum(ps.packs) > 0
          order by value desc, u.username limit 100
        `
        : sql`
          select ps.user_id, round(sum(ps.pulled_points) * 100.0 / sum(ps.expected_points)) as value,
            sum(ps.luck_packs)::int as packs, u.username, coalesce(u.display_username, u.name) as name, p.avatar
          from pack_stats ps join "user" u on u.id = ps.user_id left join players p on p.user_id = ps.user_id
          ${seasonFilter}
          group by ps.user_id, u.username, u.display_username, u.name, p.avatar
          having sum(ps.luck_packs) >= ${LUCK_MIN_PACKS} and sum(ps.expected_points) > 0
          order by sum(ps.pulled_points)::float8 / sum(ps.expected_points) desc, packs desc, u.username limit 100
        `,
    );
    rows = res.map((r) => ({
      id: r.user_id,
      name: r.name,
      username: r.username,
      avatar: r.avatar,
      value: Number(r.value),
      ...(board === "luck" ? { packs: r.packs } : {}),
    }));
  } else if (board === "elo" || board === "wealth" || board === "pass") {
    const value =
      board === "pass"
        ? sql`case when p.pass_season = ${season} then p.season_xp else 0 end`
        : board === "elo"
          ? period === "season"
            ? sql`p.elo`
            : sql`greatest(p.elo_peak, coalesce((select max(a.elo) from season_archives a where a.user_id = p.user_id), 0))`
          : period === "season"
            ? sql`p.balance`
            : sql`greatest(p.balance, coalesce((select max(a.wealth) from season_archives a where a.user_id = p.user_id), 0))`;
    const res = await db.execute<{
      user_id: string;
      value: string;
      username: string;
      name: string;
      avatar: string | null;
    }>(sql`
      select p.user_id, ${value} as value, u.username, coalesce(u.display_username, u.name) as name, p.avatar
      from players p join "user" u on u.id = p.user_id
      order by value desc, u.username limit 100
    `);
    rows = res.map((r) => ({
      id: r.user_id,
      name: r.name,
      username: r.username,
      avatar: r.avatar,
      value: board === "pass" ? passProgress(Number(r.value)).level : Number(r.value),
    }));
  } else {
    const res = await db.execute<{ id: string; name: string; tag: string; emblem: string; score: number }>(sql`
      select g.id::text, g.name, g.tag, g.emblem, coalesce(sum(s.score), 0)::int as score
      from guilds g
      left join guild_members m on m.guild_id = g.id
      left join (${collectionScoresSql(period === "season" ? season : undefined)}) s on s.owner_id = m.user_id
      group by g.id order by score desc, g.name limit 100
    `);
    rows = res.map((r) => ({ id: r.id, name: r.name, username: null, avatar: r.emblem, value: r.score, extra: r.tag }));
  }
  return rows;
}

export type { Player };
