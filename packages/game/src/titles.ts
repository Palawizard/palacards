import { ELO_START } from "./battle.js";

/**
 * Titres cosmétiques : à la fin de chaque saison, les premiers de chaque classement de saison gagnent
 * le titre de ce classement, gardé pour toujours et marqué de la saison obtenue. Aucun effet de jeu.
 */
export const TITLE_BOARDS = ["collection", "packs", "luck", "elo", "wealth", "guilds", "pass"] as const;
export type TitleBoard = (typeof TITLE_BOARDS)[number];

/** Rangs récompensés : les TITLE_MAX_RANK premiers de chaque classement. */
export const TITLE_MAX_RANK = 3;

export const TITLE_NAMES: Record<TitleBoard, string> = {
  collection: "Grand collectionneur",
  packs: "Accro aux boosters",
  luck: "Lucky guy",
  elo: "Maître des duels",
  wealth: "Magnat",
  guilds: "Champion de guilde",
  pass: "Pilier de la saison",
};

/** Nom des classements, pour situer un titre (« n° 1 en Chance »). */
export const TITLE_BOARD_LABELS: Record<TitleBoard, string> = {
  collection: "Collection",
  packs: "Boosters ouverts",
  luck: "Chance",
  elo: "Elo de bataille",
  wealth: "Richesse",
  guilds: "Guildes",
  pass: "Passe de saison",
};

export interface TitleRef {
  board: TitleBoard;
  rank: number;
  season: number;
}

/** Détail d'un titre : « n° 1 en Chance, saison 3 ». */
export function titleDetail(t: TitleRef): string {
  return `n°\u00a0${t.rank} en ${TITLE_BOARD_LABELS[t.board]}, saison ${t.season}`;
}

/**
 * Lauréats d'un classement de saison, dans l'ordre du classement : les TITLE_MAX_RANK premiers dont le score
 * compte vraiment (un Elo resté à sa valeur de départ ou un score nul ne vaut pas de titre).
 */
export function titleWinners<T extends { value: number }>(
  board: TitleBoard,
  rows: readonly T[],
): (T & { rank: number })[] {
  const min = board === "elo" ? ELO_START : 0;
  return rows
    .filter((r) => r.value > min)
    .slice(0, TITLE_MAX_RANK)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
