import { describe, expect, it } from "vitest";
import { ECONOMY } from "./economy.js";
import { CARDS_PER_PACK, DROP_TABLE_GUARANTEED, DROP_TABLE_STANDARD } from "./packs.js";
import { RARITIES, type Rarity } from "./rarity.js";
import {
  nextRarity,
  UPGRADE_MAX_CARDS,
  UPGRADE_MAX_CHANCE,
  upgradeCardsToCap,
  upgradeChance,
  upgradeChancePerCard,
  upgradeRefund,
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
    expect([1, 5, 10].map((n) => upgradeChance("UR", n))).toEqual([277, 1_388, 2_777]);
    expect(upgradeChance("C", 10)).toBe(UPGRADE_MAX_CHANCE);
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

  it("rend les légendaires deux fois plus dures à obtenir que les autres paliers", () => {
    const fair = perPack("L") / perPack("UR");
    expect(upgradeChancePerCard("UR") / 10_000).toBeCloseTo(fair / 4, 3);
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
