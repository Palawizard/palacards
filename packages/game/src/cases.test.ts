import { describe, expect, it } from "vitest";
import {
  buildReel,
  CASE_CONTENT,
  CASE_ODDS,
  CASE_PRICES,
  CASE_TIERS,
  CASE_TOTAL,
  caseExpectedValue,
  caseReturnRate,
  pickLot,
  REEL_LENGTH,
  REEL_WIN_INDEX,
  rollCase,
} from "./cases.js";

const seq = (values: number[]) => {
  let i = 0;
  return (max: number) => values[i++ % values.length]! % max;
};

describe("caisses", () => {
  it("chaque niveau somme à 10 000 et rend entre 55 et 70 % de son prix, jamais plus que son prix", () => {
    for (const tier of CASE_TIERS) {
      expect(CASE_ODDS[tier].reduce((s, o) => s + o.weight, 0)).toBe(CASE_TOTAL);
      expect(caseReturnRate(tier)).toBeGreaterThanOrEqual(0.55);
      expect(caseReturnRate(tier)).toBeLessThanOrEqual(0.7);
      expect(caseExpectedValue(tier)).toBeLessThan(CASE_PRICES[tier]);
    }
  });

  it("garde les gros lots rares et réservés aux caisses chères", () => {
    const lot = (tier: (typeof CASE_TIERS)[number], n: number) =>
      CASE_ODDS[tier].filter((o) => o.lot === n).reduce((s, o) => s + o.weight, 0);
    expect(lot("bronze", 3) + lot("bronze", 5) + lot("bronze", 10)).toBe(0);
    expect(lot("legendary", 10)).toBe(100); // 1 %
    expect(lot("gold", 10)).toBe(0);
    // Assez de légendaires différentes pour le plus gros lot de chaque niveau.
    for (const tier of CASE_TIERS) {
      const biggest = Math.max(...CASE_ODDS[tier].map((o) => o.lot));
      expect(CASE_CONTENT[tier].L ?? 0).toBeGreaterThanOrEqual(biggest > 1 ? biggest : 1);
    }
  });

  it("tire une issue selon les poids", () => {
    expect(rollCase("bronze", () => 0)).toBe(0);
    expect(rollCase("bronze", () => 9_999)).toBe(3);
    expect(rollCase("legendary", () => 9_950)).toBe(4);
  });

  it("donne des légendaires différentes dans un lot tant que la caisse en a assez", () => {
    expect(new Set(pickLot([1, 2, 3, 4, 5], 5, () => 0)).size).toBe(5);
    expect(pickLot([1, 2], 5, () => 0)).toHaveLength(5);
    expect(() => pickLot([], 1, () => 0)).toThrow();
  });

  it("place la case gagnante au bon endroit dans une bande de la bonne longueur", () => {
    const reel = buildReel("gold", { UR: [0, 1], L: [2, 3] }, { kind: "lot", lot: 5 }, seq([3, 9_000, 1, 7]));
    expect(reel).toHaveLength(REEL_LENGTH);
    expect(reel[REEL_WIN_INDEX]).toEqual({ kind: "lot", lot: 5 });
    for (const t of reel) if (t.kind === "card") expect([0, 1, 2, 3]).toContain(t.index);
  });
});
