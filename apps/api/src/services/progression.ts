import { and, desc, eq, schema, sql } from "@palacards/db";
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, applyEvent, type GameEvent } from "@palacards/game";
import type { Ctx } from "../context.js";
import { activeSeason, lockPlayer, logMovement, movePw, packState, pushWallet, type DbOrTx, type Player } from "./players.js";
import { afterCommit, Effects } from "./notifications.js";
import { battleRewarded, onBattleFinished } from "./battles.js";
import { collectionScoresSql } from "./profiles.js";

let hooksRegistered = false;
/** Branche les succès sur la fin des duels (une fois par processus, appelé au démarrage de l'app). */
export function registerProgressionHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onBattleFinished(async (ctx, battle, winnerId) => {
    for (const userId of [battle.challengerId, battle.opponentId]) {
      // Anti-farm : seules les victoires récompensées en PW (quota par paire et par jour) comptent pour les succès.
      const won = winnerId === userId && (await battleRewarded(ctx.db, userId, battle.id));
      void emit(ctx, userId, { type: "battle_finished", won, winStreak: await winStreak(ctx.db, userId) });
    }
  });
}

// ---------------------------------------------------------------------------
// Succès
// ---------------------------------------------------------------------------

/**
 * Fait progresser les succès d'un joueur après un événement du jeu. Une transaction :
 * joueur verrouillé (sérialise les événements d'un même joueur), progression, récompenses
 * (PW et paquets bonus dans le ledger) et notifications ; succès débloqué une seule fois.
 */
export async function recordEvent(ctx: Ctx, userId: string, event: GameEvent) {
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const player = await lockPlayer(tx, userId);
    const rows = await tx.select().from(schema.achievementsProgress).where(eq(schema.achievementsProgress.userId, userId));
    const current = new Map(rows.map((r) => [r.achievementKey, { progress: r.progress, unlocked: !!r.unlockedAt }]));
    const updates = applyEvent(current, event);
    let rewarded = false;
    for (const u of updates) {
      await tx
        .insert(schema.achievementsProgress)
        .values({ userId, achievementKey: u.key, progress: u.progress, unlockedAt: u.unlocked ? ctx.now() : null })
        .onConflictDoUpdate({
          target: [schema.achievementsProgress.userId, schema.achievementsProgress.achievementKey],
          set: { progress: u.progress, unlockedAt: u.unlocked ? ctx.now() : null },
        });
      if (!u.unlocked) continue;
      const def = ACHIEVEMENT_BY_KEY.get(u.key)!;
      if (def.reward.pw) await movePw(tx, player, def.reward.pw, "achievement", u.key);
      if (def.reward.packs) {
        const bonusPacks = player.bonusPacks + def.reward.packs;
        await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, userId));
        await logMovement(tx, userId, "bonus_pack", def.reward.packs, bonusPacks, "achievement", u.key);
        player.bonusPacks = bonusPacks;
      }
      await fx.notify(tx, userId, "achievement", { key: u.key, name: def.name, reward: def.reward });
      rewarded = true;
    }
    return { player, rewarded };
  });
  await afterCommit(ctx, async () => {
    if (res.rewarded) {
      pushWallet(ctx, res.player);
      ctx.rt.toUser(userId, "packs:update", packState(res.player, ctx.now()));
    }
    await fx.flush(ctx);
  });
}

/**
 * Fait progresser les succès après une action, sans jamais la faire échouer (erreurs journalisées).
 * `"collection"` recalcule l'état de la collection (articles uniques, Légendaires, part des UR).
 */
export function emit(ctx: Ctx, userId: string, ...events: (GameEvent | "collection")[]) {
  const task = (async () => {
    for (const e of events) {
      try {
        await recordEvent(ctx, userId, e === "collection" ? await collectionEvent(ctx.db, userId) : e);
      } catch (err) {
        ctx.log.error({ err, event: e === "collection" ? e : e.type }, "succès");
      }
    }
  })();
  pending.add(task);
  void task.finally(() => pending.delete(task));
  return task;
}

const pending = new Set<Promise<void>>();
/** Attend la fin des succès en cours de traitement (arrêt propre du serveur, tests). */
export async function progressionIdle() {
  while (pending.size) await Promise.allSettled([...pending]);
}

/**
 * Événement « collection » : articles uniques, Légendaires différentes, part des UR de la saison.
 * Anti-farm : seuls comptent les exemplaires que le joueur a tirés lui-même et toujours détenus
 * (`source = 'pack'` ; un transfert par échange ou vente la réécrit en `trade` / `market`, un don
 * admin vaut `admin`). Sinon des amis se prêteraient gratuitement leurs cartes pour débloquer
 * les succès de collection chacun à leur tour.
 */
export async function collectionEvent(db: DbOrTx, userId: string): Promise<GameEvent> {
  const season = await activeSeason(db);
  const [row] = await db.execute<{ unique_cards: number; unique_l: number; unique_ur: number; total_ur: number }>(sql`
    with pulled as (select card_id, rarity, season from card_instances where owner_id = ${userId} and source = 'pack')
    select
      (select count(distinct card_id)::int from pulled) as unique_cards,
      (select count(distinct card_id)::int from pulled where rarity = 'L') as unique_l,
      (select count(distinct card_id)::int from pulled where rarity = 'UR' and season = ${season}) as unique_ur,
      (select count(*)::int from cards where season = ${season} and rarity = 'UR') as total_ur
  `);
  return {
    type: "collection",
    uniqueCards: row?.unique_cards ?? 0,
    uniqueLegendary: row?.unique_l ?? 0,
    uniqueUR: row?.unique_ur ?? 0,
    totalUR: row?.total_ur ?? 0,
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

export async function listAchievements(ctx: Ctx, userId: string) {
  const rows = await ctx.db.select().from(schema.achievementsProgress).where(eq(schema.achievementsProgress.userId, userId));
  const by = new Map(rows.map((r) => [r.achievementKey, r]));
  return ACHIEVEMENTS.map((a) => ({
    key: a.key,
    name: a.name,
    description: a.description,
    target: a.target,
    reward: a.reward,
    progress: by.get(a.key)?.progress ?? 0,
    unlockedAt: by.get(a.key)?.unlockedAt?.toISOString() ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Classements
// ---------------------------------------------------------------------------

export type Board = "collection" | "elo" | "wealth" | "guilds";

interface Row {
  id: string;
  name: string;
  username: string | null;
  value: number;
  extra?: string;
}

/**
 * Classements : collection (points des articles uniques), Elo, richesse (solde) et guildes.
 * « Saison » : édition en cours et Elo remis à 1 000 ; « tout temps » : toutes éditions, meilleur Elo, archives.
 */
export async function leaderboard(ctx: Ctx, userId: string, board: Board, period: "season" | "all") {
  const season = await activeSeason(ctx.db);
  let rows: Row[] = [];
  if (board === "collection") {
    const res = await ctx.db.execute<{ owner_id: string; score: number; username: string; name: string }>(sql`
      select s.owner_id, s.score, u.username, coalesce(u.display_username, u.name) as name
      from (${collectionScoresSql(period === "season" ? season : undefined)}) s join "user" u on u.id = s.owner_id
      order by s.score desc limit 100
    `);
    rows = res.map((r) => ({ id: r.owner_id, name: r.name, username: r.username, value: r.score }));
  } else if (board === "elo" || board === "wealth") {
    const value =
      board === "elo"
        ? period === "season"
          ? sql`p.elo`
          : sql`greatest(p.elo_peak, coalesce((select max(a.elo) from season_archives a where a.user_id = p.user_id), 0))`
        : period === "season"
          ? sql`p.balance`
          : sql`greatest(p.balance, coalesce((select max(a.wealth) from season_archives a where a.user_id = p.user_id), 0))`;
    const res = await ctx.db.execute<{ user_id: string; value: string; username: string; name: string }>(sql`
      select p.user_id, ${value} as value, u.username, coalesce(u.display_username, u.name) as name
      from players p join "user" u on u.id = p.user_id
      order by value desc, u.username limit 100
    `);
    rows = res.map((r) => ({ id: r.user_id, name: r.name, username: r.username, value: Number(r.value) }));
  } else {
    const res = await ctx.db.execute<{ id: string; name: string; tag: string; emblem: string; score: number }>(sql`
      select g.id::text, g.name, g.tag, g.emblem, coalesce(sum(s.score), 0)::int as score
      from guilds g
      left join guild_members m on m.guild_id = g.id
      left join (${collectionScoresSql(period === "season" ? season : undefined)}) s on s.owner_id = m.user_id
      group by g.id order by score desc limit 100
    `);
    rows = res.map((r) => ({ id: r.id, name: `${r.emblem} ${r.name}`, username: null, value: r.score, extra: r.tag }));
  }
  const myGuild =
    board === "guilds"
      ? (await ctx.db.select({ g: schema.guildMembers.guildId }).from(schema.guildMembers).where(eq(schema.guildMembers.userId, userId)))[0]?.g
      : undefined;
  return {
    season,
    rows: rows.map((r, i) => ({ ...r, rank: i + 1, me: board === "guilds" ? String(myGuild) === r.id : r.id === userId })),
  };
}

// ---------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------

export type { Player };
