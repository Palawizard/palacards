import type { RandomInt } from "./packs.js";

/**
 * Roues du jour : trois roues par jour calendaire de Paris, à ouvrir dans l'ordre. La petite est prête dès
 * minuit ; la moyenne s'ouvre 2 h 30 après avoir tourné la petite, la grande 2 h 30 après la moyenne. Tout
 * repart à zéro à minuit : une roue qui ne serait prête qu'après minuit est perdue pour la journée.
 */
export const WHEEL_TIERS = ["small", "medium", "large"] as const;
export type WheelTier = (typeof WHEEL_TIERS)[number];

/** Attente entre deux roues, comptée depuis le tour de la précédente. */
export const WHEEL_GAP_MS = 150 * 60_000;

/**
 * Récompense d'une case. `theme` : boosters du booster à thème en vente qui se termine le plus tôt
 * (deux paquets bonus par booster s'il n'y en a aucun en vente).
 */
export type WheelReward =
  | { kind: "pw"; amount: number }
  | { kind: "packs"; amount: number }
  | { kind: "theme"; amount: number }
  | { kind: "card"; rarity: "UR" | "L" };

/** Paquets bonus donnés à la place d'un booster à thème quand aucun n'est en vente. */
export const WHEEL_THEME_FALLBACK_PACKS = 2;

export interface WheelSegment {
  reward: WheelReward;
  /** Poids en points de base (la somme vaut 10 000). */
  weight: number;
}

export const WHEEL_TOTAL = 10_000;

/**
 * Cases de chaque roue, dans l'ordre d'affichage (petits et gros lots alternés). Valeur moyenne (paquet =
 * 150 PW, booster = 200 PW, UR = 250, légendaire = 1 500) : petite ≈ 230, moyenne ≈ 360, grande ≈ 730.
 */
export const WHEELS: Record<WheelTier, WheelSegment[]> = {
  small: [
    { reward: { kind: "pw", amount: 100 }, weight: 2_500 },
    { reward: { kind: "packs", amount: 1 }, weight: 2_000 },
    { reward: { kind: "pw", amount: 200 }, weight: 2_000 },
    { reward: { kind: "card", rarity: "UR" }, weight: 500 },
    { reward: { kind: "packs", amount: 2 }, weight: 2_000 },
    { reward: { kind: "packs", amount: 3 }, weight: 800 },
    { reward: { kind: "card", rarity: "L" }, weight: 200 },
  ],
  medium: [
    { reward: { kind: "pw", amount: 200 }, weight: 2_500 },
    { reward: { kind: "packs", amount: 2 }, weight: 2_000 },
    { reward: { kind: "pw", amount: 400 }, weight: 1_800 },
    { reward: { kind: "card", rarity: "UR" }, weight: 700 },
    { reward: { kind: "packs", amount: 4 }, weight: 1_500 },
    { reward: { kind: "theme", amount: 1 }, weight: 1_200 },
    { reward: { kind: "card", rarity: "L" }, weight: 300 },
  ],
  large: [
    { reward: { kind: "pw", amount: 500 }, weight: 2_200 },
    { reward: { kind: "packs", amount: 5 }, weight: 2_000 },
    { reward: { kind: "pw", amount: 1_000 }, weight: 1_000 },
    { reward: { kind: "card", rarity: "UR" }, weight: 1_500 },
    { reward: { kind: "theme", amount: 2 }, weight: 1_500 },
    { reward: { kind: "packs", amount: 10 }, weight: 1_000 },
    { reward: { kind: "card", rarity: "L" }, weight: 800 },
  ],
};

/** Index de la case tirée sur la roue `tier`. */
export function rollWheel(tier: WheelTier, randomInt: RandomInt): number {
  const segments = WHEELS[tier];
  let roll = randomInt(WHEEL_TOTAL);
  for (let i = 0; i < segments.length; i++) {
    roll -= segments[i]!.weight;
    if (roll < 0) return i;
  }
  throw new Error("roue invalide (somme < 10 000)");
}

/** Avancement de la journée, tel qu'enregistré pour le joueur. */
export interface WheelProgress {
  /** Jour (Paris, AAAA-MM-JJ) des roues déjà tournées. */
  day: string | null;
  /** Roues tournées ce jour-là (0 à 3). */
  opened: number;
  /** Heure du dernier tour. */
  lastAt: Date | null;
}

export interface WheelSchedule {
  /** Roues déjà tournées aujourd'hui. */
  opened: number;
  /** Prochaine roue à tourner aujourd'hui (null : les trois sont faites). */
  next: WheelTier | null;
  /** Heure à laquelle elle sera prête (null : prête maintenant ou plus rien à tourner). */
  availableAt: Date | null;
  /** Prête maintenant. */
  ready: boolean;
  /** Elle ne serait prête qu'après minuit : perdue pour aujourd'hui. */
  missed: boolean;
}

/** Où en est le joueur aujourd'hui (`today` : jour de Paris, `midnight` : prochain minuit de Paris). */
export function wheelSchedule(progress: WheelProgress, now: Date, today: string, midnight: Date): WheelSchedule {
  const opened = progress.day === today ? Math.min(progress.opened, WHEEL_TIERS.length) : 0;
  const next = WHEEL_TIERS[opened] ?? null;
  if (!next) return { opened, next: null, availableAt: null, ready: false, missed: false };
  const at = opened === 0 || !progress.lastAt ? null : new Date(progress.lastAt.getTime() + WHEEL_GAP_MS);
  if (at && at >= midnight) return { opened, next, availableAt: at, ready: false, missed: true };
  const ready = !at || at <= now;
  return { opened, next, availableAt: ready ? null : at, ready, missed: false };
}
