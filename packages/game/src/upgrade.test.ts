import { describe, expect, it } from "vitest";
import { ECONOMY } from "./economy.js";
import { nextRarity, upgradeChance, upgradeRefund } from "./upgrade.js";

describe("upgrader", () => {
  it("vise la rareté juste au-dessus, rien au-dessus d'une légendaire", () => {
    expect(nextRarity("C")).toBe("PC");
    expect(nextRarity("SR")).toBe("UR");
    expect(nextRarity("UR")).toBe("L");
    expect(nextRarity("L")).toBeNull();
  });

  it("donne 40, 60 puis 80 % selon le nombre de cartes", () => {
    expect([3, 4, 5].map((n) => upgradeChance("R", n))).toEqual([4_000, 6_000, 8_000]);
  });

  it("divise les chances par deux vers une légendaire", () => {
    expect([3, 4, 5].map((n) => upgradeChance("UR", n))).toEqual([2_000, 3_000, 4_000]);
  });

  it("refuse une légendaire et un nombre de cartes hors 3 à 5", () => {
    expect(() => upgradeChance("L", 3)).toThrow(RangeError);
    expect(() => upgradeChance("C", 2)).toThrow(RangeError);
    expect(() => upgradeChance("C", 6)).toThrow(RangeError);
  });

  it("rend la moitié de la valeur de recyclage en cas d'échec (arrondi vers le bas)", () => {
    expect(upgradeRefund("UR", 4)).toBe((ECONOMY.recycleValue.UR * 4) / 2);
    expect(upgradeRefund("C", 3)).toBe(1);
    expect(upgradeRefund("PC", 5)).toBe(7);
  });
});
