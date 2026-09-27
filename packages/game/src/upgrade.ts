import { ECONOMY } from "./economy.js";
import { RARITIES, type Rarity } from "./rarity.js";

/** Upgrader : 3 à 5 cartes d'une même rareté pour tenter une carte de la rareté au-dessus. */
export const UPGRADE_MIN_CARDS = 3;
export const UPGRADE_MAX_CARDS = 5;

/** Chances de réussite en points de base (sur 10 000), selon le nombre de cartes sacrifiées. */
export const UPGRADE_CHANCE: Record<number, number> = { 3: 4_000, 4: 6_000, 5: 8_000 };
/** Vers une légendaire, les chances sont divisées par deux. */
export const UPGRADE_LEGENDARY_FACTOR = 0.5;
/** En cas d'échec, part de la valeur de recyclage des cartes rendue en PW. */
export const UPGRADE_REFUND_RATE = 0.5;

/** Rareté juste au-dessus (null pour une légendaire : rien au-dessus). */
export function nextRarity(r: Rarity): Rarity | null {
  return RARITIES[RARITIES.indexOf(r) + 1] ?? null;
}

/** Chance de réussite (points de base) d'un upgrade de `count` cartes de rareté `from`. */
export function upgradeChance(from: Rarity, count: number): number {
  const target = nextRarity(from);
  if (!target) throw new RangeError("une légendaire ne s'améliore pas");
  const base = UPGRADE_CHANCE[count];
  if (base === undefined) throw new RangeError(`nombre de cartes invalide : ${count}`);
  return target === "L" ? Math.round(base * UPGRADE_LEGENDARY_FACTOR) : base;
}

/** PW rendus si l'upgrade échoue : la moitié de la valeur de recyclage, arrondie en défaveur du joueur. */
export function upgradeRefund(from: Rarity, count: number): number {
  return Math.floor(ECONOMY.recycleValue[from] * count * UPGRADE_REFUND_RATE);
}
