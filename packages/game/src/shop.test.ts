import { describe, expect, it } from "vitest";
import { seededRandom } from "./battle.js";
import type { RandomInt } from "./packs.js";
import {
  planShop,
  rollShopRarity,
  SHOP_PRICES,
  SHOP_RARITIES,
  SHOP_SIZE,
  shopMargin,
  shopTotal,
  type ShopPool,
  type ShopRarity,
} from "./shop.js";

/** Tirage déterministe (graine) au format `RandomInt`. */
const seeded = (seed: string): RandomInt => {
  const next = seededRandom(seed);
  return (max) => Math.floor(next() * max);
};

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
const pools = (unowned: number, owned: number): Record<ShopRarity, ShopPool> => ({
  SR: { unowned: range(1_000, unowned), owned: range(1_500, owned) },
  UR: { unowned: range(2_000, unowned), owned: range(2_500, owned) },
  L: { unowned: range(3_000, unowned), owned: range(3_500, owned) },
});

describe("boutique du jour", () => {
  it("tire les raretés à SR 50 %, UR 35 %, L 15 % (±2 % sur 100 000 tirages)", () => {
    const random = seeded("taux");
    const counts: Record<ShopRarity, number> = { SR: 0, UR: 0, L: 0 };
    for (let i = 0; i < 100_000; i++) counts[rollShopRarity(random)]++;
    expect(counts.SR / 100_000).toBeCloseTo(0.5, 1);
    expect(Math.abs(counts.SR / 100_000 - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(counts.UR / 100_000 - 0.35)).toBeLessThan(0.02);
    expect(Math.abs(counts.L / 100_000 - 0.15)).toBeLessThan(0.02);
  });

  it("donne 20 cartes toutes différentes, identiques avec la même graine", () => {
    const a = planShop(seeded("joueur:2026-10-22"), pools(40, 40));
    const b = planShop(seeded("joueur:2026-10-22"), pools(40, 40));
    expect(a).toHaveLength(SHOP_SIZE);
    expect(new Set(a.map((i) => i.cardId)).size).toBe(SHOP_SIZE);
    expect(b).toEqual(a);
    expect(planShop(seeded("joueur:2026-10-23"), pools(40, 40))).not.toEqual(a);
  });

  it("prend en priorité les cartes que le joueur ne possède pas", () => {
    const shop = planShop(seeded("priorite"), pools(30, 30));
    const ownedIds = new Set(SHOP_RARITIES.flatMap((r) => pools(30, 30)[r].owned));
    expect(shop.every((i) => !ownedIds.has(i.cardId))).toBe(true);
  });

  it("complète avec des cartes déjà possédées quand il n'en reste plus de nouvelles", () => {
    const shop = planShop(seeded("complete"), pools(2, 30));
    expect(shop).toHaveLength(SHOP_SIZE);
    const unownedIds = new Set(SHOP_RARITIES.flatMap((r) => pools(2, 30)[r].unowned));
    // Les 6 nouvelles cartes passent avant les autres de leur rareté.
    for (const r of SHOP_RARITIES) {
      const ofRarity = shop.filter((i) => i.rarity === r);
      const fresh = ofRarity.filter((i) => unownedIds.has(i.cardId)).length;
      expect(fresh).toBe(Math.min(2, ofRarity.length));
    }
  });

  it("une rareté vide laisse la place aux autres, sans doublon", () => {
    const shop = planShop(seeded("vide"), {
      SR: { unowned: range(1, 25), owned: [] },
      UR: { unowned: [], owned: [] },
      L: { unowned: [], owned: [] },
    });
    expect(shop).toHaveLength(SHOP_SIZE);
    expect(shop.every((i) => i.rarity === "SR")).toBe(true);
    expect(planShop(seeded("rien"), pools(0, 0))).toEqual([]);
  });

  it("prix fixes toujours au-dessus de la valeur de recyclage", () => {
    expect(SHOP_PRICES).toEqual({ SR: 200, UR: 800, L: 3_500 });
    for (const r of SHOP_RARITIES) expect(shopMargin(r)).toBeGreaterThan(0);
    // Boutique moyenne : 10 SR, 7 UR, 3 L.
    const avg = [
      ...Array<{ rarity: ShopRarity }>(10).fill({ rarity: "SR" }),
      ...Array<{ rarity: ShopRarity }>(7).fill({ rarity: "UR" }),
      ...Array<{ rarity: ShopRarity }>(3).fill({ rarity: "L" }),
    ];
    expect(shopTotal(avg)).toBe(18_100);
  });
});
