import { describe, expect, it } from "vitest";
import { collectionScore, effectiveStats, isBetterCopy, MAX_LEVEL } from "./collection.js";

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
