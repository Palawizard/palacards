import type { Rarity } from "./rarity.js";

export const CARDS_PER_PACK = 10;
/** Plafond du stock de paquets gratuits. Un nouveau joueur commence plein (ensurePlayer, côté API). */
export const MAX_STORED_PACKS = 30;
export const PACK_REGEN_MS = 10 * 60 * 1000;
export const PITY_THRESHOLD = 50;

/**
 * Taux de drop en « points de base » sur 10 000 (0,07 % = 7).
 * Chaque table doit sommer à exactement 10 000.
 */
export type DropTable = Record<Rarity, number>;

export const DROP_TABLE_STANDARD: DropTable = {
  C: 6_200,
  PC: 2_500,
  R: 950,
  SR: 300,
  UR: 43,
  L: 7,
};

/** Dernier emplacement du paquet : Rare ou mieux garanti. */
export const DROP_TABLE_GUARANTEED: DropTable = {
  C: 0,
  PC: 0,
  R: 8_600,
  SR: 1_150,
  UR: 243,
  L: 7,
};

/** Pity : UR ou mieux garanti. L garde son poids relatif. */
export const DROP_TABLE_PITY: DropTable = {
  C: 0,
  PC: 0,
  R: 0,
  SR: 0,
  UR: 9_720,
  L: 280,
};

export const DROP_TABLE_TOTAL = 10_000;

/** Générateur d'entiers uniformes dans [0, max[. En prod : crypto.randomInt. */
export type RandomInt = (max: number) => number;

const ROLL_ORDER: Rarity[] = ["L", "UR", "SR", "R", "PC", "C"];

export function rollRarity(table: DropTable, randomInt: RandomInt): Rarity {
  let roll = randomInt(DROP_TABLE_TOTAL);
  for (const rarity of ROLL_ORDER) {
    roll -= table[rarity];
    if (roll < 0) return rarity;
  }
  throw new Error("table de drop invalide (somme < 10 000)");
}

export interface PackRollResult {
  rarities: Rarity[];
  /** Nouvelle valeur du compteur de pity après ce paquet. */
  pityCounter: number;
}

/**
 * Tire les raretés d'un paquet. Le choix de l'article dans chaque palier
 * se fait ensuite en base (index `(rarity, rand_key)`).
 */
export function rollPack(pityCounter: number, randomInt: RandomInt): PackRollResult {
  const pityTriggered = pityCounter >= PITY_THRESHOLD;
  const rarities: Rarity[] = [];
  for (let slot = 0; slot < CARDS_PER_PACK - 1; slot++) {
    rarities.push(rollRarity(DROP_TABLE_STANDARD, randomInt));
  }
  rarities.push(rollRarity(pityTriggered ? DROP_TABLE_PITY : DROP_TABLE_GUARANTEED, randomInt));

  const gotUrOrBetter = rarities.some((r) => r === "UR" || r === "L");
  return { rarities, pityCounter: gotUrOrBetter ? 0 : pityCounter + 1 };
}

/** Stock de paquets disponible, calculé à la lecture (pas de cron). */
export function availablePacks(stored: number, updatedAt: Date, now: Date): number {
  const elapsed = Math.max(0, now.getTime() - updatedAt.getTime());
  return Math.min(MAX_STORED_PACKS, stored + Math.floor(elapsed / PACK_REGEN_MS));
}

/** Temps avant le prochain paquet (0 si le stock est plein). */
export function msUntilNextPack(stored: number, updatedAt: Date, now: Date): number {
  if (availablePacks(stored, updatedAt, now) >= MAX_STORED_PACKS) return 0;
  const elapsed = Math.max(0, now.getTime() - updatedAt.getTime());
  return PACK_REGEN_MS - (elapsed % PACK_REGEN_MS);
}

/**
 * Retire un paquet gratuit du stock (null si vide). Garde la progression du minuteur,
 * sauf si le stock était plein : la régénération était en pause, elle repart de maintenant.
 */
export function consumeFreePack(
  stored: number,
  updatedAt: Date,
  now: Date,
): { stored: number; updatedAt: Date } | null {
  const available = availablePacks(stored, updatedAt, now);
  if (available <= 0) return null;
  if (available >= MAX_STORED_PACKS) return { stored: MAX_STORED_PACKS - 1, updatedAt: now };
  const elapsed = Math.max(0, now.getTime() - updatedAt.getTime());
  const ticks = Math.floor(elapsed / PACK_REGEN_MS);
  return { stored: available - 1, updatedAt: new Date(updatedAt.getTime() + ticks * PACK_REGEN_MS) };
}
