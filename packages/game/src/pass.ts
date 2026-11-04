import type { GameEvent } from "./achievements.js";
import type { CaseTier } from "./cases.js";
import { GUILD_OBJECTIVE_REWARD } from "./guild.js";

// ---------------------------------------------------------------------------
// Passe de saison gratuit : 200 niveaux par saison mensuelle, tout le monde repart de 0.
// L'XP vient des actions (paquets, quêtes, « Plus ou moins vu », boss, duels…) ; chaque niveau donne
// des PW ou des paquets bonus, avec un gros palier tous les 10 niveaux. Après le niveau 200, l'XP
// continue de compter : chaque niveau supplémentaire donne quelques PW, sans limite.
// ---------------------------------------------------------------------------

/** Dernier niveau de la carte de saison (cases à tamponner). */
export const PASS_MAX_LEVEL = 200;
/** Fin du recto de la carte (niveaux 1 à 100) ; le verso va de 101 à 200. */
export const PASS_HALF_LEVEL = 100;
/** XP de chaque niveau à partir du niveau 100 (verso de la carte et niveaux supplémentaires). */
export const PASS_LATE_LEVEL_XP = 500;
/** PW de chaque niveau supplémentaire, au-delà du niveau 200. */
export const PASS_OVERFLOW_PW = 25;

/** XP pour passer du niveau `level - 1` au niveau `level` (302 au début, 500 à partir du niveau 100). */
export function xpForLevel(level: number): number {
  return level >= PASS_HALF_LEVEL ? PASS_LATE_LEVEL_XP : 300 + 2 * level;
}

/** XP cumulée pour finir le recto (40 100 XP). */
const XP_TO_HALF = Array.from({ length: PASS_HALF_LEVEL }, (_, i) => xpForLevel(i + 1)).reduce((a, b) => a + b, 0);

/** XP cumulée pour atteindre un niveau (40 100 XP pour le niveau 100, 90 100 pour le niveau 200). */
export function xpToReach(level: number): number {
  if (level >= PASS_HALF_LEVEL) return XP_TO_HALF + (level - PASS_HALF_LEVEL) * PASS_LATE_LEVEL_XP;
  let total = 0;
  for (let n = 1; n <= level; n++) total += xpForLevel(n);
  return total;
}

export interface PassProgress {
  /** Niveau atteint ; dépasse `PASS_MAX_LEVEL` avec les niveaux supplémentaires. */
  level: number;
  /** XP gagnée dans le niveau en cours. */
  into: number;
  /** XP du niveau en cours. */
  need: number;
}

export function passProgress(xp: number): PassProgress {
  const total = Math.max(0, Math.floor(xp));
  if (total >= XP_TO_HALF) {
    const rest = total - XP_TO_HALF;
    return {
      level: PASS_HALF_LEVEL + Math.floor(rest / PASS_LATE_LEVEL_XP),
      into: rest % PASS_LATE_LEVEL_XP,
      need: PASS_LATE_LEVEL_XP,
    };
  }
  let level = 0;
  let rest = total;
  while (rest >= xpForLevel(level + 1)) {
    rest -= xpForLevel(level + 1);
    level++;
  }
  return { level, into: rest, need: xpForLevel(level + 1) };
}

export interface PassReward {
  pw: number;
  packs: number;
  /** Caisse gratuite (suggestion n° 126), à ouvrir dans n'importe quel thème en cours de ce niveau. */
  case?: CaseTier;
}

/** Au-delà du niveau 200 : une caisse Bronze tous les `PASS_OVERFLOW_CASE_EVERY` niveaux (à la place des PW). */
export const PASS_OVERFLOW_CASE_EVERY = 10;

/**
 * Récompense d'un niveau : en alternance des paquets bonus (niveaux impairs) et des PW (niveaux pairs),
 * 2 paquets tous les 5 niveaux ; tous les 10, 3 paquets, 50 PW et une caisse Bronze ; aux niveaux 50 et 150,
 * 3 paquets et une caisse Argent ; aux niveaux 100 et 200, 5 paquets, 250 PW et une caisse Or. Les caisses
 * (2026-11-04) remplacent des PW à valeur à peu près égale (caisse = son prix). Au-delà du niveau 200, chaque
 * niveau donne `PASS_OVERFLOW_PW`, et une caisse Bronze tous les `PASS_OVERFLOW_CASE_EVERY` niveaux.
 */
export function passReward(level: number): PassReward {
  if (level > PASS_MAX_LEVEL)
    return level % PASS_OVERFLOW_CASE_EVERY === 0
      ? { pw: 0, packs: 0, case: "bronze" }
      : { pw: PASS_OVERFLOW_PW, packs: 0 };
  if (level % PASS_HALF_LEVEL === 0) return { pw: 250, packs: 5, case: "gold" };
  if (level % 50 === 0) return { pw: 0, packs: 3, case: "silver" };
  if (level % 10 === 0) return { pw: 50, packs: 3, case: "bronze" };
  if (level % 5 === 0) return { pw: 0, packs: 2 };
  if (level % 2 === 0) return { pw: 50 + Math.floor(level / 2), packs: 0 };
  return { pw: 0, packs: 1 };
}

/** XP gagnée par événement (les quêtes ajoutent la leur à part). */
export const XP = {
  pack: 10,
  themedPack: 25,
  wheel: 20,
  login: 25,
  battleWin: 40,
  battleLoss: 15,
  /** « Plus ou moins vu » : par essai terminé, plus par réussite (10 réussites au plus). */
  hlPlayed: 20,
  hlWin: 10,
  bossAssault: 60,
  /** Par phase du boss dont on touche la récompense (deux phases : l'ancienne chute, 300 XP). */
  bossPhase: 150,
  upgrade: 10,
  /** Par caisse ouverte. */
  caseOpened: 15,
  trade: 20,
  sale: 20,
  guildObjective: GUILD_OBJECTIVE_REWARD.xp,
} as const;

export function xpForEvent(e: GameEvent): number {
  switch (e.type) {
    case "pack_opened":
      return e.themed ? XP.themedPack : XP.pack;
    case "wheel_spun":
      return XP.wheel;
    case "daily_login":
      return XP.login;
    case "battle_finished":
      return e.won ? XP.battleWin : XP.battleLoss;
    case "hl_finished":
      return XP.hlPlayed + XP.hlWin * Math.min(e.streak, 10);
    case "boss_assault":
      return XP.bossAssault;
    case "boss_phase":
      return XP.bossPhase;
    case "upgrade":
      return XP.upgrade;
    case "case_opened":
      return XP.caseOpened * e.count;
    case "trade_done":
      return XP.trade;
    case "sale":
      return XP.sale;
    case "guild_objective":
      return XP.guildObjective;
    default:
      return 0;
  }
}
