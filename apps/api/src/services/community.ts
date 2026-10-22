import { and, eq, schema, sql } from "@palacards/db";
import {
  COMMUNITY_GOAL_REFRESH_MS,
  COMMUNITY_GOAL_TIERS,
  communityRewardBetween,
  communityTiersReached,
} from "@palacards/game";
import type { CommunityGoalDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { afterCommit, Effects } from "./notifications.js";
import { activeSeason, lockPlayer, logMovement, movePw, packState, pushWallet } from "./players.js";

export const COMMUNITY_GOAL_JOB = "community-goal";

/**
 * Recompte les articles différents de la saison active tirés au moins une fois (`pulls`, index
 * `(season, card_id)`) et l'enregistre. Appelé par le job toutes les 10 minutes : la page Succès ne fait que
 * lire la ligne. Un nouveau palier déclenche le versement à tous les joueurs concernés (les absents le
 * touchent aussi à leur prochaine connexion, voir `claimCommunityRewards`).
 */
export async function refreshCommunityGoal(ctx: Ctx) {
  const season = await activeSeason(ctx.db);
  const [row] = await ctx.db.execute<{ n: number; total: number }>(sql`
    select (select count(distinct card_id)::int from pulls where season = ${season}) as n,
           (select count(*)::int from cards where season = ${season}) as total
  `);
  const distinct = row?.n ?? 0;
  const seasonCards = row?.total ?? 0;
  const tiers = communityTiersReached(distinct);
  const g = schema.communityGoals;
  const [before] = await ctx.db.select({ tiers: g.tiersReached }).from(g).where(eq(g.season, season));
  await ctx.db
    .insert(g)
    .values({ season, distinctCards: distinct, seasonCards, tiersReached: tiers, computedAt: ctx.now() })
    .onConflictDoUpdate({
      target: g.season,
      // Jamais de palier perdu (purge du fil d'activité après 60 jours, par exemple).
      set: {
        distinctCards: distinct,
        seasonCards,
        tiersReached: sql`greatest(${g.tiersReached}, ${tiers})`,
        computedAt: ctx.now(),
      },
    });
  if (tiers > (before?.tiers ?? 0)) {
    const players = await ctx.db
      .select({ userId: schema.packStats.userId })
      .from(schema.packStats)
      .where(and(eq(schema.packStats.season, season), sql`${schema.packStats.packs} > 0`));
    for (const p of players) await claimCommunityRewards(ctx, p.userId);
  }
  return { season, distinct, tiers };
}

/**
 * Verse au joueur les paliers atteints qu'il n'a pas encore touchés, s'il a ouvert au moins un paquet dans
 * la saison. Idempotent : une ligne par (saison, palier, joueur), clé primaire, posée dans la même transaction
 * que les PW et les paquets ; deux appels simultanés ne versent qu'une fois.
 */
export async function claimCommunityRewards(ctx: Ctx, userId: string) {
  const season = await activeSeason(ctx.db);
  const g = schema.communityGoals;
  const [goal] = await ctx.db.select().from(g).where(eq(g.season, season));
  if (!goal?.tiersReached) return null;
  const fx = new Effects();
  const res = await ctx.db.transaction(async (tx) => {
    const [opened] = await tx
      .select({ packs: schema.packStats.packs })
      .from(schema.packStats)
      .where(and(eq(schema.packStats.userId, userId), eq(schema.packStats.season, season)));
    if (!opened?.packs) return null;
    const p = await lockPlayer(tx, userId);
    const r = schema.communityGoalRewards;
    const fresh = await tx
      .insert(r)
      .values(Array.from({ length: goal.tiersReached }, (_, i) => ({ season, tier: i + 1, userId })))
      .onConflictDoNothing()
      .returning({ tier: r.tier });
    if (!fresh.length) return null;
    const tiers = fresh.map((t) => t.tier).sort((a, b) => a - b);
    let pw = 0;
    let packs = 0;
    for (const tier of tiers) {
      const reward = communityRewardBetween(tier - 1, tier);
      pw += reward.pw;
      packs += reward.packs;
    }
    await movePw(tx, p, pw, "community_goal", `S${season}:${tiers.join(",")}`);
    if (packs) {
      p.bonusPacks += packs;
      await tx.update(schema.players).set({ bonusPacks: p.bonusPacks }).where(eq(schema.players.userId, userId));
      await logMovement(tx, userId, "bonus_pack", packs, p.bonusPacks, "community_goal", `S${season}`);
    }
    const top = tiers[tiers.length - 1]!;
    await fx.notify(tx, userId, "community_goal", {
      season,
      tiers,
      cards: COMMUNITY_GOAL_TIERS[top - 1]!.cards,
      reward: { pw, packs },
    });
    return { player: p, pw, packs, tiers };
  });
  if (!res) return null;
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.player);
    if (res.packs) ctx.rt.toUser(userId, "packs:update", packState(res.player, ctx.now()));
    await fx.flush(ctx);
  });
  return { pw: res.pw, packs: res.packs, tiers: res.tiers };
}

/** Compteur pour la page Succès : la ligne en cache (jamais de comptage pendant la requête). */
export async function communityGoal(ctx: Ctx, userId: string): Promise<CommunityGoalDTO> {
  const season = await activeSeason(ctx.db);
  const [goal] = await ctx.db.select().from(schema.communityGoals).where(eq(schema.communityGoals.season, season));
  const [eligible] = await ctx.db
    .select({ packs: schema.packStats.packs })
    .from(schema.packStats)
    .where(and(eq(schema.packStats.userId, userId), eq(schema.packStats.season, season)));
  const rewarded = await ctx.db
    .select({ tier: schema.communityGoalRewards.tier })
    .from(schema.communityGoalRewards)
    .where(and(eq(schema.communityGoalRewards.season, season), eq(schema.communityGoalRewards.userId, userId)));
  // Ligne absente ou trop vieille (job en panne) : un recalcul part en arrière-plan, la réponse n'attend pas.
  if (!goal || ctx.now().getTime() - goal.computedAt.getTime() > 2 * COMMUNITY_GOAL_REFRESH_MS)
    refreshInBackground(ctx);
  return {
    season,
    distinctCards: goal?.distinctCards ?? 0,
    tiersReached: goal?.tiersReached ?? 0,
    computedAt: goal?.computedAt.toISOString() ?? null,
    eligible: !!eligible?.packs,
    rewardedTiers: rewarded.map((r) => r.tier).sort((a, b) => a - b),
    tiers: COMMUNITY_GOAL_TIERS.map((t) => ({ ...t })),
    seasonCards: goal?.seasonCards ?? 0,
  };
}

let refreshing: Promise<unknown> | null = null;
function refreshInBackground(ctx: Ctx) {
  if (refreshing) return;
  refreshing = refreshCommunityGoal(ctx)
    .catch((err) => ctx.log.error({ err }, "objectif communautaire"))
    .finally(() => (refreshing = null));
}
