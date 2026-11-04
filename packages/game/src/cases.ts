import { ECONOMY } from "./economy.js";
import type { RandomInt } from "./packs.js";
import type { Rarity } from "./rarity.js";

// ---------------------------------------------------------------------------
// Caisses (suggestion n° 126, « case opening » à la CS) : une caisse au contenu visible, achetée en PW (ou
// gagnée dans les roues et le passe), donne UNE issue : une carte, ou pour les caisses les plus chères un lot
// de 3, 5 ou 10 légendaires d'un coup. Deux thèmes par semaine, chacun en quatre niveaux.
//
// Équilibrage (données de la prod du 2026-11-04) : un booster à thème à 200 PW rend en moyenne ~126 PW au
// recyclage (63 %), et le recyclage a rendu 60 % des PW dépensés en boosters sur 14 jours. Chaque caisse rend
// en moyenne 55 à 70 % de son prix en valeur de recyclage : jamais plus que son prix, sinon acheter puis
// recycler fabriquerait des PW sans fin (les achats ne sont pas limités, choix de Palawi).
// ---------------------------------------------------------------------------

export const CASE_TIERS = ["bronze", "silver", "gold", "legendary"] as const;
export type CaseTier = (typeof CASE_TIERS)[number];

export const CASE_TIER_LABELS: Record<CaseTier, string> = {
  bronze: "Bronze",
  silver: "Argent",
  gold: "Or",
  legendary: "Légendaire",
};

/** Prix d'ouverture en PW (choix de Palawi). */
export const CASE_PRICES: Record<CaseTier, number> = {
  bronze: 100,
  silver: 300,
  gold: 750,
  legendary: 2_000,
};

/** Issue d'une caisse : une carte de cette rareté (`lot` = 1), ou un lot de `lot` légendaires. */
export interface CaseOutcome {
  rarity: Rarity;
  lot: number;
  /** Poids sur `CASE_TOTAL`. */
  weight: number;
}

export const CASE_TOTAL = 10_000;

/** Issues de chaque niveau, des plus fréquentes aux plus rares. */
export const CASE_ODDS: Record<CaseTier, CaseOutcome[]> = {
  bronze: [
    { rarity: "R", lot: 1, weight: 4_500 },
    { rarity: "SR", lot: 1, weight: 3_750 },
    { rarity: "UR", lot: 1, weight: 1_500 },
    { rarity: "L", lot: 1, weight: 250 },
  ],
  silver: [
    { rarity: "SR", lot: 1, weight: 4_500 },
    { rarity: "UR", lot: 1, weight: 4_500 },
    { rarity: "L", lot: 1, weight: 900 },
    { rarity: "L", lot: 3, weight: 100 },
  ],
  gold: [
    { rarity: "UR", lot: 1, weight: 7_150 },
    { rarity: "L", lot: 1, weight: 2_400 },
    { rarity: "L", lot: 3, weight: 300 },
    { rarity: "L", lot: 5, weight: 150 },
  ],
  legendary: [
    { rarity: "UR", lot: 1, weight: 3_600 },
    { rarity: "L", lot: 1, weight: 5_100 },
    { rarity: "L", lot: 3, weight: 800 },
    { rarity: "L", lot: 5, weight: 400 },
    { rarity: "L", lot: 10, weight: 100 },
  ],
};

/** Nombre de cartes de chaque rareté dans le contenu d'une caisse (choisies par l'atelier des boosters). */
export const CASE_CONTENT: Record<CaseTier, Partial<Record<Rarity, number>>> = {
  bronze: { R: 12, SR: 10, UR: 6, L: 2 },
  silver: { SR: 10, UR: 12, L: 5 },
  gold: { UR: 12, L: 10 },
  legendary: { UR: 10, L: 15 },
};

/** Valeur de recyclage d'une issue (PW, sans brillance). */
export const outcomeValue = (o: Pick<CaseOutcome, "rarity" | "lot">) => ECONOMY.recycleValue[o.rarity] * o.lot;

/** Valeur de recyclage moyenne d'une ouverture (PW). */
export function caseExpectedValue(tier: CaseTier): number {
  return CASE_ODDS[tier].reduce((s, o) => s + (o.weight * outcomeValue(o)) / CASE_TOTAL, 0);
}

/** Part du prix rendue en moyenne au recyclage. */
export const caseReturnRate = (tier: CaseTier) => caseExpectedValue(tier) / CASE_PRICES[tier];

/** Index de l'issue tirée. */
export function rollCase(tier: CaseTier, randomInt: RandomInt): number {
  const odds = CASE_ODDS[tier];
  let roll = randomInt(CASE_TOTAL);
  for (let i = 0; i < odds.length; i++) {
    roll -= odds[i]!.weight;
    if (roll < 0) return i;
  }
  throw new Error("caisse invalide (somme < 10 000)");
}

/**
 * Cartes d'un lot de `count` légendaires parmi celles de la caisse : toutes différentes tant que la caisse
 * en a assez, puis on recommence la liste (tirage sans remise par passes).
 */
export function pickLot<T>(pool: T[], count: number, randomInt: RandomInt): T[] {
  if (!pool.length) throw new Error("caisse sans légendaire");
  const out: T[] = [];
  while (out.length < count) {
    const left = [...pool];
    while (left.length && out.length < count) out.push(left.splice(randomInt(left.length), 1)[0]!);
  }
  return out;
}

/** Une case de la bande qui défile : une carte de la caisse, ou un lot de légendaires. */
export type ReelTile = { kind: "card"; index: number } | { kind: "lot"; lot: number };

/** Cases de la bande, la gagnante comprise (à `REEL_WIN_INDEX`). */
export const REEL_LENGTH = 48;
/** Position de la case gagnante : assez loin pour une longue course, avec quelques cases après elle. */
export const REEL_WIN_INDEX = 42;

/**
 * Bande honnête : chaque case est tirée selon les vraies chances de la caisse, sans placer exprès de gros lots
 * autour de la case gagnante (le « presque gagné » répété est ce qui frustre le plus les joueurs de CS).
 * `cards` : indices des cartes de la caisse par rareté.
 */
export function buildReel(
  tier: CaseTier,
  cards: Partial<Record<Rarity, number[]>>,
  win: ReelTile,
  randomInt: RandomInt,
): ReelTile[] {
  const tiles: ReelTile[] = [];
  for (let i = 0; i < REEL_LENGTH; i++) {
    if (i === REEL_WIN_INDEX) {
      tiles.push(win);
      continue;
    }
    const o = CASE_ODDS[tier][rollCase(tier, randomInt)]!;
    if (o.lot > 1) {
      tiles.push({ kind: "lot", lot: o.lot });
      continue;
    }
    const pool = cards[o.rarity]?.length ? cards[o.rarity]! : Object.values(cards).flat();
    tiles.push({ kind: "card", index: pool[randomInt(pool.length)]! });
  }
  return tiles;
}

/** Ouvertures d'un coup (bouton « Ouvrir ×5 »). */
export const CASE_MULTI_OPEN = 5;
