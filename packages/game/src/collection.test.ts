import { describe, expect, it } from "vitest";
import {
  autoRecyclePicks,
  collectionScore,
  effectiveStats,
  isBetterCopy,
  MAX_LEVEL,
  planFusions,
  type FusionCopy,
} from "./collection.js";

describe("effectiveStats", () => {
  it("+4 % par niveau au-delà du premier", () => {
    expect(effectiveStats(1000, 2000, 1)).toEqual({ atk: 1000, def: 2000 });
    expect(effectiveStats(1000, 2000, 2)).toEqual({ atk: 1040, def: 2080 });
    expect(effectiveStats(1000, 2000, MAX_LEVEL)).toEqual({ atk: 1160, def: 2320 });
  });

  it("refuse un niveau hors bornes", () => {
    expect(() => effectiveStats(1, 1, 0)).toThrow(RangeError);
    expect(() => effectiveStats(1, 1, 6)).toThrow(RangeError);
  });
});

describe("collectionScore", () => {
  it("compte chaque article une fois, à sa meilleure rareté", () => {
    expect(
      collectionScore([
        { cardId: 1, rarity: "C" },
        { cardId: 1, rarity: "C" },
        { cardId: 2, rarity: "R" },
        { cardId: 2, rarity: "L" },
      ]),
    ).toBe(1 + 1000);
  });

  it("vaut 0 sans carte", () => {
    expect(collectionScore([])).toBe(0);
  });
});

describe("isBetterCopy", () => {
  const base = { id: 1, rarity: "UR" as const, level: 1, atk: 500, def: 500 };
  it("classe par rareté, puis niveau, puis stats, puis ancienneté", () => {
    expect(isBetterCopy({ ...base, rarity: "L", id: 9 }, { ...base, level: 5 })).toBe(true);
    expect(isBetterCopy({ ...base, level: 2, atk: 1 }, base)).toBe(true);
    expect(isBetterCopy({ ...base, atk: 501, id: 9 }, base)).toBe(true);
    expect(isBetterCopy(base, { ...base, id: 2 })).toBe(true);
    expect(isBetterCopy({ ...base, id: 2 }, base)).toBe(false);
  });
});

describe("autoRecyclePicks", () => {
  const drawn = [
    { cardId: 1, rarity: "C" as const },
    { cardId: 2, rarity: "PC" as const },
    { cardId: 2, rarity: "PC" as const },
    { cardId: 3, rarity: "R" as const },
    { cardId: 4, rarity: "UR" as const },
  ];

  it("désactivé : ne recycle rien", () => {
    expect(autoRecyclePicks(drawn, null, false, new Set())).toEqual([]);
  });

  it("recycle la rareté choisie et en dessous", () => {
    expect(autoRecyclePicks(drawn, "PC", false, new Set())).toEqual([0, 1, 2]);
    expect(autoRecyclePicks(drawn, "SR", false, new Set())).toEqual([0, 1, 2, 3]);
  });

  it("garde les nouveaux articles, une seule fois", () => {
    expect(autoRecyclePicks(drawn, "R", true, new Set([1]))).toEqual([0, 2]);
  });
});

describe("planFusions", () => {
  const copy = (id: number, over: Partial<FusionCopy> = {}): FusionCopy => ({
    id,
    cardId: 1,
    rarity: "C",
    level: 1,
    atk: 100,
    def: 100,
    consumable: true,
    locked: false,
    ...over,
  });

  it("monte le meilleur exemplaire avec les plus faibles doublons, jusqu'au niveau maximal", () => {
    const plans = planFusions([
      copy(1, { level: 3 }),
      copy(2, { atk: 50 }),
      copy(3),
      copy(4, { atk: 10 }),
      copy(5, { level: 2 }),
    ]);
    expect(plans).toEqual([{ cardId: 1, targetId: 1, fromLevel: 3, toLevel: MAX_LEVEL, sourceIds: [4, 2] }]);
  });

  it("ne consomme ni les exemplaires protégés ni le meilleur, et ne fusionne pas dans un exemplaire engagé", () => {
    expect(planFusions([copy(1), copy(2, { consumable: false })])).toEqual([]);
    // La brillante est le meilleur exemplaire : elle reçoit la fusion, jamais l'inverse.
    expect(planFusions([copy(1), copy(2, { shiny: true, consumable: false })])).toEqual([
      { cardId: 1, targetId: 2, fromLevel: 1, toLevel: 2, sourceIds: [1] },
    ]);
    expect(planFusions([copy(1, { rarity: "R", locked: true }), copy(2)])).toEqual([]);
    expect(planFusions([copy(1, { level: MAX_LEVEL }), copy(2)])).toEqual([]);
    expect(planFusions([copy(1)])).toEqual([]);
  });

  it("traite chaque article à part", () => {
    const plans = planFusions([
      copy(1),
      copy(2),
      copy(3, { cardId: 9 }),
      copy(4, { cardId: 9 }),
      copy(5, { cardId: 7 }),
    ]);
    expect(plans.map((p) => [p.cardId, p.targetId, p.sourceIds])).toEqual([
      [1, 1, [2]],
      [9, 3, [4]],
    ]);
  });
});
