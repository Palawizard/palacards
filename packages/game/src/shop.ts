import { ECONOMY } from "./economy.js";
import type { RandomInt } from "./packs.js";
import type { Rarity } from "./rarity.js";

/**
 * Boutique du jour : une sélection personnelle de cartes de la saison active, renouvelée à minuit (heure de
 * Paris), figée en base à la première visite du jour. Prix fixes, toujours au-dessus de la valeur de recyclage :
 * acheter puis recycler ne rapporte rien. Un puits de PW, pas un dû.
 */
export const SHOP_SIZE = 20;

export type ShopRarity = "SR" | "UR" | "L";
export const SHOP_RARITIES: readonly ShopRarity[] = ["SR", "UR", "L"];

/** Chance de chaque rareté par emplacement, en pour cent (tirée indépendamment pour chaque emplacement). */
export const SHOP_RARITY_WEIGHTS: Record<ShopRarity, number> = { SR: 50, UR: 35, L: 15 };

/** Prix fixe d'une carte de la boutique (PW). */
export const SHOP_PRICES: Record<ShopRarity, number> = { SR: 200, UR: 800, L: 3_500 };

export const isShopRarity = (r: Rarity): r is ShopRarity => (SHOP_RARITIES as readonly Rarity[]).includes(r);

/** Rareté d'un emplacement : SR 50 %, UR 35 %, L 15 %. */
export function rollShopRarity(random: RandomInt): ShopRarity {
  let roll = random(100);
  for (const r of SHOP_RARITIES) {
    roll -= SHOP_RARITY_WEIGHTS[r];
    if (roll < 0) return r;
  }
  return "SR";
}

/** Candidats d'une rareté : d'abord les cartes que le joueur ne possède pas, puis les autres. */
export interface ShopPool {
  unowned: readonly number[];
  owned: readonly number[];
}

/**
 * Compose la boutique : `size` emplacements, rareté tirée pour chacun, carte prise au hasard parmi les
 * non possédées de cette rareté, à défaut parmi toutes. Jamais deux fois la même carte. Une rareté épuisée
 * (base minuscule) laisse l'emplacement à une autre rareté disponible.
 */
export function planShop(
  random: RandomInt,
  pools: Record<ShopRarity, ShopPool>,
  size = SHOP_SIZE,
): { cardId: number; rarity: ShopRarity }[] {
  const left = Object.fromEntries(
    SHOP_RARITIES.map((r) => [r, { unowned: [...pools[r].unowned], owned: [...pools[r].owned] }]),
  ) as Record<ShopRarity, { unowned: number[]; owned: number[] }>;
  const take = (list: number[]) => list.splice(random(list.length), 1)[0]!;
  const out: { cardId: number; rarity: ShopRarity }[] = [];
  const taken = new Set<number>();
  while (out.length < size) {
    const available = SHOP_RARITIES.filter((r) => left[r].unowned.length + left[r].owned.length > 0);
    if (!available.length) break;
    let rarity = rollShopRarity(random);
    if (!available.includes(rarity)) rarity = available[random(available.length)]!;
    const pool = left[rarity];
    const cardId = take(pool.unowned.length ? pool.unowned : pool.owned);
    if (taken.has(cardId)) continue;
    taken.add(cardId);
    out.push({ cardId, rarity });
  }
  return out;
}

/** Coût de toute la boutique (affichage et contrôle de l'économie). */
export const shopTotal = (items: readonly { rarity: ShopRarity }[]) =>
  items.reduce((s, i) => s + SHOP_PRICES[i.rarity], 0);

/** Acheter puis recycler doit toujours coûter des PW : contrôlé par les tests. */
export const shopMargin = (r: ShopRarity) => SHOP_PRICES[r] - ECONOMY.recycleValue[r];
