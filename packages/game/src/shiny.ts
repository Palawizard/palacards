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

export function rollShiny(randomInt: RandomInt, chance = SHINY_CHANCE): boolean {
  return randomInt(SHINY_TOTAL) < chance;
}

/** Systèmes hors paquets qui donnent une carte : upgrader (réussite), roues du jour (lot carte), boutique (achat). */
export type ShinySource = "upgrade" | "wheel" | "shop";

/**
 * Chance de brillance (sur `SHINY_TOTAL`) d'une carte donnée par chaque système hors paquets : 0 = jamais
 * brillante. Identique aux paquets partout. Dans l'upgrader, le tirage ne dépend pas des cartes sacrifiées.
 */
export const SHINY_SOURCE_CHANCE: Record<ShinySource, number> = {
  upgrade: SHINY_CHANCE,
  wheel: SHINY_CHANCE,
  shop: SHINY_CHANCE,
};

/** Tirage de brillance d'une carte donnée par un système hors paquets (aucun tirage si le système n'en donne pas). */
export function rollSourceShiny(source: ShinySource, randomInt: RandomInt): boolean {
  const chance = SHINY_SOURCE_CHANCE[source];
  return chance > 0 && rollShiny(randomInt, chance);
}

/** PW rendus au recyclage d'un exemplaire. */
export function recycleValue(rarity: Rarity, shiny = false): number {
  return ECONOMY.recycleValue[rarity] * (shiny ? SHINY_RECYCLE_MULT : 1);
}
