import { describe, expect, it } from "vitest";
import { COMMUNITY_GOAL_TIERS, communityRewardBetween, communityTiersReached } from "./community.js";

describe("objectif communautaire", () => {
  it("paliers de la saison : 400 000 à 1,5 million d'articles différents", () => {
    expect(COMMUNITY_GOAL_TIERS.map((t) => t.cards)).toEqual([400_000, 500_000, 750_000, 1_000_000, 1_500_000]);
    expect(COMMUNITY_GOAL_TIERS.map((t) => [t.pw, t.packs])).toEqual([
      [300, 0],
      [500, 0],
      [800, 1],
      [1_200, 2],
      [2_000, 3],
    ]);
  });

  it("compte les paliers atteints", () => {
    expect(communityTiersReached(0)).toBe(0);
    expect(communityTiersReached(333_600)).toBe(0);
    expect(communityTiersReached(400_000)).toBe(1);
    expect(communityTiersReached(749_999)).toBe(2);
    expect(communityTiersReached(2_600_000)).toBe(5);
  });

  it("cumule les récompenses des paliers pas encore versés", () => {
    expect(communityRewardBetween(0, 0)).toEqual({ pw: 0, packs: 0 });
    expect(communityRewardBetween(0, 2)).toEqual({ pw: 800, packs: 0 });
    expect(communityRewardBetween(2, 5)).toEqual({ pw: 4_000, packs: 6 });
    expect(communityRewardBetween(5, 5)).toEqual({ pw: 0, packs: 0 });
  });
});
