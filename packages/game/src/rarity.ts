/** Paliers de rareté, du plus commun au plus rare. */
export const RARITIES = ["C", "PC", "R", "SR", "UR", "L"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABELS: Record<Rarity, string> = {
  C: "Commune",
  PC: "Peu commune",
  R: "Rare",
  SR: "Super rare",
  UR: "Ultra rare",
  L: "Légendaire",
};

/**
 * Rang maximal (en vues sur 12 mois) pour appartenir à chaque palier.
 * Au-delà de PC, la carte est commune.
 */
export const RARITY_RANK_CEILING: Record<Exclude<Rarity, "C">, number> = {
  L: 1_000,
  UR: 10_000,
  SR: 50_000,
  R: 250_000,
  PC: 1_000_000,
};

/** Points de collection par carte unique possédée. */
export const COLLECTION_POINTS: Record<Rarity, number> = {
  C: 1,
  PC: 2,
  R: 5,
  SR: 20,
  UR: 100,
  L: 1_000,
};

/** Rareté d'un article à partir de son rang en vues (1 = le plus lu). */
export function rarityFromViewRank(rank: number): Rarity {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new RangeError(`rang invalide : ${rank}`);
  }
  if (rank <= RARITY_RANK_CEILING.L) return "L";
  if (rank <= RARITY_RANK_CEILING.UR) return "UR";
  if (rank <= RARITY_RANK_CEILING.SR) return "SR";
  if (rank <= RARITY_RANK_CEILING.R) return "R";
  if (rank <= RARITY_RANK_CEILING.PC) return "PC";
  return "C";
}
