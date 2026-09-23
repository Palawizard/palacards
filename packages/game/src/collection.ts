import { COLLECTION_POINTS, RARITIES, type Rarity } from "./rarity.js";

export const MAX_LEVEL = 5;
/** Bonus d'ATK et de DEF par niveau gagné par fusion (+4 %). */
export const LEVEL_BONUS = 0.04;

/** Stats effectives d'un exemplaire : stats figées au tirage × (1 + 4 % par niveau au-delà du 1er). */
export function effectiveStats(atk: number, def: number, level: number): { atk: number; def: number } {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new RangeError(`niveau invalide : ${level}`);
  const mult = 1 + LEVEL_BONUS * (level - 1);
  return { atk: Math.round(atk * mult), def: Math.round(def * mult) };
}

export function rarityRank(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/**
 * Score de collection : somme des points de rareté sur les cartes **uniques** (un article compte une fois,
 * à sa meilleure rareté possédée). Récompense la diversité plutôt que les doublons.
 */
export function collectionScore(owned: Iterable<{ cardId: number; rarity: Rarity }>): number {
  const best = new Map<number, Rarity>();
  for (const { cardId, rarity } of owned) {
    const prev = best.get(cardId);
    if (!prev || rarityRank(rarity) > rarityRank(prev)) best.set(cardId, rarity);
  }
  let score = 0;
  for (const r of best.values()) score += COLLECTION_POINTS[r];
  return score;
}
