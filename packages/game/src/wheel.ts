import type { RandomInt } from "./packs.js";

/** Récompense d'une case de la roue quotidienne. */
export type WheelReward =
  { kind: "pw"; amount: number } | { kind: "packs"; amount: number } | { kind: "card"; rarity: "UR" | "L" };

export interface WheelSegment {
  reward: WheelReward;
  /** Poids en points de base (la somme vaut 10 000). */
  weight: number;
}

/**
 * Cases de la roue, dans l'ordre d'affichage (on alterne petits et gros lots).
 * Un tour gratuit par jour calendaire de Paris, en plus du bonus de connexion.
 */
export const WHEEL_SEGMENTS: WheelSegment[] = [
  { reward: { kind: "pw", amount: 25 }, weight: 3_000 },
  { reward: { kind: "packs", amount: 1 }, weight: 2_000 },
  { reward: { kind: "pw", amount: 50 }, weight: 2_400 },
  { reward: { kind: "card", rarity: "UR" }, weight: 500 },
  { reward: { kind: "pw", amount: 100 }, weight: 1_200 },
  { reward: { kind: "packs", amount: 3 }, weight: 800 },
  { reward: { kind: "card", rarity: "L" }, weight: 100 },
];

export const WHEEL_TOTAL = 10_000;

/** Index de la case tirée. */
export function rollWheel(randomInt: RandomInt): number {
  let roll = randomInt(WHEEL_TOTAL);
  for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
    roll -= WHEEL_SEGMENTS[i]!.weight;
    if (roll < 0) return i;
  }
  throw new Error("roue invalide (somme < 10 000)");
}
