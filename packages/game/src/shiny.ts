import { ECONOMY } from "./economy.js";
import type { RandomInt } from "./packs.js";
import type { Rarity } from "./rarity.js";

/**
 * Cartes brillantes (« shiny ») : chaque carte tirée, quelle que soit sa rareté, a une petite chance
 * de sortir en version brillante. Purement cosmétique (mêmes ATK et DEF), mais rare et mieux recyclée.
 * 10 sur 10 000 = 0,1 % par carte, soit environ 1 % par paquet de 10.
 */
export const SHINY_CHANCE = 10;
export const SHINY_TOTAL = 10_000;
/** Une brillante se recycle 10 fois mieux que la même carte normale. */
export const SHINY_RECYCLE_MULT = 10;

export function rollShiny(randomInt: RandomInt): boolean {
  return randomInt(SHINY_TOTAL) < SHINY_CHANCE;
}

/** PW rendus au recyclage d'un exemplaire. */
export function recycleValue(rarity: Rarity, shiny = false): number {
  return ECONOMY.recycleValue[rarity] * (shiny ? SHINY_RECYCLE_MULT : 1);
}
