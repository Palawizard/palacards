import { and, eq, schema, sql } from "@palacards/db";
import { COMMUNITY_GOAL_TIERS } from "@palacards/game";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "../src/context.js";
import { claimCommunityRewards, refreshCommunityGoal } from "../src/services/community.js";
import { activeSeason } from "../src/services/players.js";
import { makeApp, signUp } from "./helpers.js";

let app: Awaited<ReturnType<typeof makeApp>>["app"];
let ctx: Ctx;
let season: number;

beforeAll(async () => {
  ({ app, ctx } = await makeApp());
  season = await activeSeason(ctx.db);
});

afterAll(async () => {
  // Base partagée : le compteur forcé par ces tests ne doit pas verser de paliers aux autres fichiers.
  await ctx.db.delete(schema.communityGoals).where(eq(schema.communityGoals.season, season));
  await app.close();
});

/** Force le compteur en cache (la base de test n'a que quelques milliers de cartes). */
async function setGoal(distinct: number, tiers: number) {
  await ctx.db
    .insert(schema.communityGoals)
    .values({ season, distinctCards: distinct, tiersReached: tiers, seasonCards: 3000 })
    .onConflictDoUpdate({
      target: schema.communityGoals.season,
      set: { distinctCards: distinct, tiersReached: tiers, computedAt: new Date() },
    });
}

async function rewardsOf(userId: string) {
  const [row] = await ctx.db.execute<{ pw: string; packs: string; notifs: number }>(sql`
    select coalesce((select sum(delta) from ledger where user_id = ${userId} and reason = 'community_goal' and kind = 'pw'), 0) as pw,
           coalesce((select sum(delta) from ledger where user_id = ${userId} and reason = 'community_goal' and kind = 'bonus_pack'), 0) as packs,
           (select count(*)::int from notifications where user_id = ${userId} and type = 'community_goal') as notifs
  `);
  return { pw: Number(row!.pw), packs: Number(row!.packs), notifs: row!.notifs };
}

describe("objectif communautaire (suggestion n° 105)", () => {
  it("compte les articles différents de la saison tirés au moins une fois", async () => {
    const p = await signUp(app);
    expect((await p.post("/packs/open")).status).toBe(200);
    const [row] = await ctx.db.execute<{ n: number }>(
      sql`select count(distinct card_id)::int as n from pulls where season = ${season}`,
    );
    const res = await refreshCommunityGoal(ctx);
    expect(res.distinct).toBe(row!.n);
    const goal = (await p.get("/community-goal")).body;
    expect(goal).toMatchObject({ season, distinctCards: row!.n, eligible: true, rewardedTiers: [] });
    expect(goal.tiers).toHaveLength(COMMUNITY_GOAL_TIERS.length);
  });

  it("verse chaque palier une seule fois, à la connexion, aux joueurs qui ont ouvert un paquet", async () => {
    const opener = await signUp(app);
    const idle = await signUp(app);
    expect((await opener.post("/packs/open")).status).toBe(200);
    await setGoal(760_000, 3);

    // Connexion (bonus du jour) : les 3 paliers d'un coup, 1 600 PW et 1 paquet bonus.
    const daily = await opener.post("/daily");
    expect(daily.body.community).toEqual({ pw: 1_600, packs: 1, tiers: [1, 2, 3] });
    expect(await rewardsOf(opener.userId)).toEqual({ pw: 1_600, packs: 1, notifs: 1 });
    // Nouvelle connexion, appels simultanés : rien de plus.
    await Promise.all(Array.from({ length: 5 }, () => claimCommunityRewards(ctx, opener.userId)));
    await opener.post("/daily");
    expect(await rewardsOf(opener.userId)).toEqual({ pw: 1_600, packs: 1, notifs: 1 });

    // Sans paquet ouvert cette saison : rien.
    await idle.post("/daily");
    expect(await rewardsOf(idle.userId)).toEqual({ pw: 0, packs: 0, notifs: 0 });

    // Palier suivant : seul le nouveau est versé.
    await setGoal(1_000_000, 4);
    await opener.post("/daily");
    expect(await rewardsOf(opener.userId)).toEqual({ pw: 2_800, packs: 3, notifs: 2 });
    const goal = (await opener.get("/community-goal")).body;
    expect(goal.rewardedTiers).toEqual([1, 2, 3, 4]);
  });

  it("5 versements concurrents : une seule récompense", async () => {
    const p = await signUp(app);
    expect((await p.post("/packs/open")).status).toBe(200);
    await setGoal(400_000, 1);
    await Promise.all(Array.from({ length: 5 }, () => claimCommunityRewards(ctx, p.userId)));
    expect(await rewardsOf(p.userId)).toEqual({ pw: 300, packs: 0, notifs: 1 });
  });

  it("une autre saison repart de zéro", async () => {
    const p = await signUp(app);
    await setGoal(500_000, 2);
    // Paliers versés dans une saison passée : sans effet sur la saison active.
    await ctx.db
      .insert(schema.communityGoalRewards)
      .values({ season: season - 1, tier: 1, userId: p.userId })
      .onConflictDoNothing();
    expect((await p.post("/packs/open")).status).toBe(200);
    await claimCommunityRewards(ctx, p.userId);
    const rows = await ctx.db
      .select()
      .from(schema.communityGoalRewards)
      .where(and(eq(schema.communityGoalRewards.userId, p.userId), eq(schema.communityGoalRewards.season, season)));
    expect(rows.map((r) => r.tier).sort()).toEqual([1, 2]);
  });
});
