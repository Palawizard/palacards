import { describe, expect, it } from "vitest";
import { ECONOMY } from "./economy.js";
import { CARDS_PER_PACK, DROP_TABLE_GUARANTEED, DROP_TABLE_STANDARD } from "./packs.js";
import { RARITIES, type Rarity } from "./rarity.js";
import {
  clampSeriesLots,
  nextRarity,
  UPGRADE_MAX_CARDS,
  UPGRADE_MAX_CHANCE,
  upgradeCardsToCap,
  upgradeChance,
  upgradeChancePerCard,
  upgradeRefund,
  upgradeSeriesLots,
  upgradeSeriesSummary,
  UPGRADE_SERIES_MAX_LOTS,
} from "./upgrade.js";

/** Nombre moyen de cartes d'une rareté par paquet. */
const perPack = (r: Rarity) => ((CARDS_PER_PACK - 1) * DROP_TABLE_STANDARD[r] + DROP_TABLE_GUARANTEED[r]) / 10_000;

describe("upgrader", () => {
  it("vise la rareté juste au-dessus, rien au-dessus d'une légendaire", () => {
    expect(nextRarity("C")).toBe("PC");
    expect(nextRarity("SR")).toBe("UR");
    expect(nextRarity("UR")).toBe("L");
    expect(nextRarity("L")).toBeNull();
  });

  it("donne une chance au prorata du nombre de cartes, plafonnée à 75 %", () => {
    expect([1, 3, 5, 10].map((n) => upgradeChance("SR", n))).toEqual([818, 2_454, 4_090, 7_500]);
    expect([1, 5, 10].map((n) => upgradeChance("UR", n))).toEqual([416, 2_083, 4_166]);
    expect(upgradeChance("C", 10)).toBe(UPGRADE_MAX_CHANCE);
  });

  it("garde exactement les mêmes chances qu'avant l'upgrade en série transparent (suggestion n° 107)", () => {
    // Table figée : toute évolution des chances doit être voulue et visible ici.
    const table = Object.fromEntries(
      RARITIES.slice(0, -1).map((r) => [r, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => upgradeChance(r, n))]),
    );
    expect(table).toMatchSnapshot();
    expect(UPGRADE_MAX_CHANCE).toBe(7_500);
    for (const r of RARITIES.slice(0, -1)) expect(Math.max(...table[r]!)).toBeLessThanOrEqual(7_500);
  });

  it("est toujours perdant en moyenne : moins de la moitié de la valeur en rareté des cartes", () => {
    for (const from of RARITIES.slice(0, -1)) {
      const to = nextRarity(from)!;
      for (let n = 1; n <= UPGRADE_MAX_CARDS; n++) {
        const fair = (n * perPack(to)) / perPack(from);
        expect(upgradeChance(from, n) / 10_000).toBeLessThanOrEqual(fair * 0.5 + 1e-9);
      }
    }
  });

  it("rend les légendaires un peu plus dures à obtenir que les autres paliers", () => {
    const fair = perPack("L") / perPack("UR");
    expect(upgradeChancePerCard("UR") / 10_000).toBeCloseTo(fair * 0.375, 3);
  });

  it("indique à partir de combien de cartes la chance est plafonnée", () => {
    expect(upgradeCardsToCap("C")).toBe(4);
    expect(upgradeCardsToCap("SR")).toBe(10);
    expect(upgradeCardsToCap("UR")).toBeNull();
  });

  it("refuse une légendaire et un nombre de cartes hors 1 à 10", () => {
    expect(() => upgradeChance("L", 3)).toThrow(RangeError);
    expect(() => upgradeChance("C", 0)).toThrow(RangeError);
    expect(() => upgradeChance("C", 11)).toThrow(RangeError);
    expect(() => upgradeChance("C", 1.5)).toThrow(RangeError);
  });

  it("rend un quart de la valeur de recyclage en cas d'échec (arrondi vers le bas)", () => {
    expect(upgradeRefund("UR", 4)).toBe(ECONOMY.recycleValue.UR);
    expect(upgradeRefund("SR", 5)).toBe(50);
    expect(upgradeRefund("C", 3)).toBe(0);
  });
});

describe("upgrade en série", () => {
  it("fait des lots au plafond, puis un dernier lot avec le reste", () => {
    const cap = upgradeCardsToCap("C")!;
    expect(upgradeSeriesLots("C", cap * 3 + 1)).toEqual([cap, cap, cap, 1]);
    expect(upgradeSeriesLots("SR", 23)).toEqual([10, 10, 3]);
    // Le plafond n'est jamais atteint vers une légendaire : lots de 10.
    expect(upgradeSeriesLots("UR", 12)).toEqual([10, 2]);
  });

  it("ne dépasse pas le nombre de lots par clic, et rien pour une légendaire ou sans doublon", () => {
    expect(upgradeSeriesLots("C", 10_000)).toHaveLength(UPGRADE_SERIES_MAX_LOTS);
    expect(upgradeSeriesLots("L", 20)).toEqual([]);
    expect(upgradeSeriesLots("R", 0)).toEqual([]);
  });

  it("lance exactement le nombre de lots choisi, ramené au maximum possible", () => {
    const cap = upgradeCardsToCap("C")!;
    expect(upgradeSeriesLots("C", 10_000, 7)).toEqual(Array(7).fill(cap));
    expect(upgradeSeriesLots("C", 10_000, 23)).toHaveLength(23);
    // Pas assez de cartes : tous les lots possibles, le dernier avec le reste.
    expect(upgradeSeriesLots("SR", 23, 10)).toEqual([10, 10, 3]);
    expect(upgradeSeriesLots("C", 10_000, 999)).toHaveLength(UPGRADE_SERIES_MAX_LOTS);
    expect(upgradeSeriesLots("C", 10_000, 0)).toHaveLength(1);
    expect(upgradeSeriesLots("C", 10_000, 1)).toEqual([cap]);
  });

  it("borne le nombre de lots demandé entre 1 et le maximum par clic", () => {
    expect([0, -3, 1, 7.8, 50, 51, Number.NaN].map(clampSeriesLots)).toEqual([
      1,
      1,
      1,
      7,
      UPGRADE_SERIES_MAX_LOTS,
      UPGRADE_SERIES_MAX_LOTS,
      UPGRADE_SERIES_MAX_LOTS,
    ]);
  });

  it("résume un plan : cartes, réussites attendues et PW rendus au pire", () => {
    const plan = upgradeSeriesLots("SR", 23);
    expect(upgradeSeriesSummary("SR", plan)).toEqual({
      cards: 23,
      expectedSuccesses: Math.round((2 * upgradeChance("SR", 10) + upgradeChance("SR", 3)) / 1_000) / 10,
      refundIfAllFail: 2 * upgradeRefund("SR", 10) + upgradeRefund("SR", 3),
    });
    expect(upgradeSeriesSummary("SR", [])).toEqual({ cards: 0, expectedSuccesses: 0, refundIfAllFail: 0 });
  });

  it("aucun lot ne perd de rendement par carte (plafond mis à part)", () => {
    for (const r of ["C", "PC", "R", "SR", "UR"] as const)
      for (const n of upgradeSeriesLots(r, 17))
        expect(upgradeChance(r, n)).toBeGreaterThanOrEqual(Math.min(UPGRADE_MAX_CHANCE, n * upgradeChance(r, 1)));
  });
});
