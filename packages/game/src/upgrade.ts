import { ECONOMY } from "./economy.js";
import { CARDS_PER_PACK, DROP_TABLE_GUARANTEED, DROP_TABLE_STANDARD } from "./packs.js";
import { RARITIES, type Rarity } from "./rarity.js";

/** Upgrader : 1 à 10 cartes d'une même rareté pour tenter une carte de la rareté au-dessus. */
export const UPGRADE_MIN_CARDS = 1;
export const UPGRADE_MAX_CARDS = 10;

/** Chance maximale (points de base, sur 10 000), même avec beaucoup de cartes. */
export const UPGRADE_MAX_CHANCE = 7_500;
/**
 * Marge de la maison : chaque carte ne compte que pour la moitié de ce qu'elle vaut en rareté. Un upgrade
 * est donc toujours perdant en moyenne : il écoule les doublons sans fabriquer de raretés à la chaîne.
 */
export const UPGRADE_HOUSE_EDGE = 0.5;
/** Vers une légendaire, les chances sont encore divisées par deux. */
export const UPGRADE_LEGENDARY_FACTOR = 0.5;
/** En cas d'échec, part de la valeur de recyclage des cartes rendue en PW. */
export const UPGRADE_REFUND_RATE = 0.25;

/** Rareté juste au-dessus (null pour une légendaire : rien au-dessus). */
export function nextRarity(r: Rarity): Rarity | null {
  return RARITIES[RARITIES.indexOf(r) + 1] ?? null;
}

/** Nombre moyen de cartes d'une rareté par paquet standard (en points de base), tiré des tables de tirage. */
const perPack = (r: Rarity) => (CARDS_PER_PACK - 1) * DROP_TABLE_STANDARD[r] + DROP_TABLE_GUARANTEED[r];

/**
 * Chance de réussite (points de base) d'un upgrade de `count` cartes de rareté `from`.
 * Au prorata de la rareté : une SR sort environ 6 fois plus souvent qu'une UR, elle vaut donc 1/6 d'UR.
 * Chaque carte apporte cette part, divisée par la marge (et encore par deux vers une légendaire),
 * le tout plafonné à 75 %. Exemples : 5 SR → 40,9 % d'UR ; 10 UR → 27,7 % de légendaire.
 */
export function upgradeChance(from: Rarity, count: number): number {
  const target = nextRarity(from);
  if (!target) throw new RangeError("une légendaire ne s'améliore pas");
  if (!Number.isInteger(count) || count < UPGRADE_MIN_CARDS || count > UPGRADE_MAX_CARDS)
    throw new RangeError(`nombre de cartes invalide : ${count}`);
  const factor = (1 - UPGRADE_HOUSE_EDGE) * (target === "L" ? UPGRADE_LEGENDARY_FACTOR : 1);
  const raw = Math.floor((count * perPack(target) * 10_000 * factor) / perPack(from));
  return Math.min(UPGRADE_MAX_CHANCE, raw);
}

/** Chance apportée par une seule carte (points de base), avant plafond : pour l'affichage. */
export function upgradeChancePerCard(from: Rarity): number {
  return upgradeChance(from, 1);
}

/** Nombre de cartes à partir duquel la chance atteint le plafond (null s'il n'est jamais atteint). */
export function upgradeCardsToCap(from: Rarity): number | null {
  for (let n = UPGRADE_MIN_CARDS; n <= UPGRADE_MAX_CARDS; n++)
    if (upgradeChance(from, n) >= UPGRADE_MAX_CHANCE) return n;
  return null;
}

/** PW rendus si l'upgrade échoue : un quart de la valeur de recyclage, arrondi en défaveur du joueur. */
export function upgradeRefund(from: Rarity, count: number): number {
  return Math.floor(ECONOMY.recycleValue[from] * count * UPGRADE_REFUND_RATE);
}
