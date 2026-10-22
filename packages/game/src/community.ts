/**
 * Objectif communautaire de la saison (suggestion n° 105) : nombre d'articles différents de la saison active
 * tirés par au moins un joueur. Chaque palier atteint récompense une fois chaque joueur ayant ouvert au
 * moins un paquet dans la saison. Remis à zéro à chaque saison (compté par saison).
 */
export interface CommunityTier {
  /** Articles différents tirés par la communauté. */
  cards: number;
  pw: number;
  /** Paquets bonus (hors plafond du stock). */
  packs: number;
}

export const COMMUNITY_GOAL_TIERS: readonly CommunityTier[] = [
  { cards: 400_000, pw: 300, packs: 0 },
  { cards: 500_000, pw: 500, packs: 0 },
  { cards: 750_000, pw: 800, packs: 1 },
  { cards: 1_000_000, pw: 1_200, packs: 2 },
  { cards: 1_500_000, pw: 2_000, packs: 3 },
];

/** Durée de vie du compteur en cache (recalculé en arrière-plan, jamais pendant une page). */
export const COMMUNITY_GOAL_REFRESH_MS = 10 * 60 * 1000;

/** Nombre de paliers atteints (0 à `tiers.length`). */
export function communityTiersReached(distinct: number, tiers: readonly CommunityTier[] = COMMUNITY_GOAL_TIERS) {
  let n = 0;
  while (n < tiers.length && distinct >= tiers[n]!.cards) n++;
  return n;
}

/** Récompense cumulée des paliers `from + 1` à `to` (1 = premier palier). */
export function communityRewardBetween(
  from: number,
  to: number,
  tiers: readonly CommunityTier[] = COMMUNITY_GOAL_TIERS,
) {
  const out = { pw: 0, packs: 0 };
  for (let t = Math.max(0, from); t < Math.min(to, tiers.length); t++) {
    out.pw += tiers[t]!.pw;
    out.packs += tiers[t]!.packs;
  }
  return out;
}
