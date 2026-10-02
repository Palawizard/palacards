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

export interface CopyRank {
  id: number;
  rarity: Rarity;
  level: number;
  atk: number;
  def: number;
  shiny?: boolean;
}
/**
 * Ordre des exemplaires d'un même article : rareté, brillante, niveau, puis ATK+DEF, le plus ancien
 * (id le plus petit) à égalité. Le meilleur est celui qu'on garde (doublons) et le seul dans lequel on fusionne.
 */
export function isBetterCopy(a: CopyRank, b: CopyRank): boolean {
  const x = [rarityRank(a.rarity), a.shiny ? 1 : 0, a.level, a.atk + a.def];
  const y = [rarityRank(b.rarity), b.shiny ? 1 : 0, b.level, b.atk + b.def];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return a.id < b.id;
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

/** Seuils proposés au recyclage automatique : jamais au-delà de Super rare (une UR ou une L se garde). */
export const AUTO_RECYCLE_RARITIES = ["C", "PC", "R", "SR"] as const satisfies readonly Rarity[];
export type AutoRecycleRarity = (typeof AUTO_RECYCLE_RARITIES)[number];

/**
 * Recyclage automatique d'un paquet : indices des cartes tirées à recycler, celles dont la rareté est
 * au plus `max`. Avec `keepNew`, un article jamais possédé est gardé (une seule fois s'il sort en double).
 * Une brillante n'est jamais recyclée automatiquement.
 */
export function autoRecyclePicks(
  drawn: readonly { cardId: number; rarity: Rarity; shiny?: boolean }[],
  max: AutoRecycleRarity | null,
  keepNew: boolean,
  ownedBefore: ReadonlySet<number>,
): number[] {
  if (!max) return [];
  const kept = new Set(ownedBefore);
  const picks: number[] = [];
  drawn.forEach((d, i) => {
    if (d.shiny || rarityRank(d.rarity) > rarityRank(max)) return;
    if (keepNew && !kept.has(d.cardId)) {
      kept.add(d.cardId);
      return;
    }
    picks.push(i);
  });
  return picks;
}
