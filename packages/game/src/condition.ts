import type { RandomInt } from "./packs.js";

/**
 * État de conservation d'un exemplaire, tiré à l'obtention (paquet, roue, upgrader), du plus abîmé (1) au plus
 * soigné (5). Purement cosmétique : ni les stats, ni le recyclage, ni les gains n'en dépendent.
 */
export const CONDITIONS = [1, 2, 3, 4, 5] as const;
export type CardCondition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<CardCondition, string> = {
  1: "Abîmée",
  2: "Usée",
  3: "Correcte",
  4: "Bonne",
  5: "Parfaite",
};

/** État des exemplaires obtenus avant l'arrivée des états (valeur par défaut de la colonne). */
export const DEFAULT_CONDITION: CardCondition = 3;

/** Chances de tirage de chaque état, sur 100. */
export const CONDITION_WEIGHTS: Record<CardCondition, number> = {
  1: 10,
  2: 20,
  3: 40,
  4: 25,
  5: 5,
};
const CONDITION_TOTAL = CONDITIONS.reduce((sum, c) => sum + CONDITION_WEIGHTS[c], 0);

export function rollCondition(randomInt: RandomInt): CardCondition {
  let roll = randomInt(CONDITION_TOTAL);
  for (const c of CONDITIONS) {
    roll -= CONDITION_WEIGHTS[c];
    if (roll < 0) return c;
  }
  return DEFAULT_CONDITION;
}
