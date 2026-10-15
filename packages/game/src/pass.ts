import type { GameEvent } from "./achievements.js";
import { GUILD_OBJECTIVE_REWARD } from "./guild.js";

// ---------------------------------------------------------------------------
// Passe de saison gratuit : 100 niveaux par saison mensuelle, tout le monde repart de 0.
// L'XP vient des actions (paquets, quêtes, article du jour, boss, duels…) ; chaque niveau donne
// des PW ou des paquets bonus, avec un gros palier tous les 10 niveaux.
// ---------------------------------------------------------------------------

export const PASS_MAX_LEVEL = 100;

/** XP pour passer du niveau `level - 1` au niveau `level` (302 au début, 500 à la fin). */
export function xpForLevel(level: number): number {
  return 300 + 2 * level;
}

/** XP cumulée pour atteindre un niveau (40 100 XP pour le niveau 100). */
export function xpToReach(level: number): number {
  let total = 0;
  for (let n = 1; n <= Math.min(level, PASS_MAX_LEVEL); n++) total += xpForLevel(n);
  return total;
}

export interface PassProgress {
  level: number;
  /** XP gagnée dans le niveau en cours. */
  into: number;
  /** XP du niveau en cours (0 au niveau maximal). */
  need: number;
}

export function passProgress(xp: number): PassProgress {
  let level = 0;
  let rest = Math.max(0, xp);
  while (level < PASS_MAX_LEVEL && rest >= xpForLevel(level + 1)) {
    rest -= xpForLevel(level + 1);
    level++;
  }
  return level >= PASS_MAX_LEVEL ? { level, into: 0, need: 0 } : { level, into: rest, need: xpForLevel(level + 1) };
}

export interface PassReward {
  pw: number;
  packs: number;
}

/**
 * Récompense d'un niveau : en alternance des paquets bonus (niveaux impairs) et des PW (niveaux pairs),
 * 2 paquets tous les 5 niveaux, 3 paquets et 150 PW tous les 10, le niveau 100 donne 5 paquets et 1 000 PW.
 * Total d'une saison complète : 92 paquets bonus et environ 5 350 PW.
 */
export function passReward(level: number): PassReward {
  if (level === PASS_MAX_LEVEL) return { pw: 1_000, packs: 5 };
  if (level % 10 === 0) return { pw: 150, packs: 3 };
  if (level % 5 === 0) return { pw: 0, packs: 2 };
  if (level % 2 === 0) return { pw: 50 + Math.floor(level / 2), packs: 0 };
  return { pw: 0, packs: 1 };
}

// ---------------------------------------------------------------------------
// Après le niveau 100 : l'XP continue de compter et chaque tranche donne une récompense bonus
// répétable, plafonnée par saison. Le compteur repart de 0 avec la saison, comme le reste du passe.
// ---------------------------------------------------------------------------

/** Une récompense bonus tous les `PASS_BONUS_LEVELS` niveaux d'XP (au prix du niveau 100). */
export const PASS_BONUS_LEVELS = 5;
/** XP d'une tranche bonus : 2 500 XP. */
export const PASS_BONUS_XP = PASS_BONUS_LEVELS * xpForLevel(PASS_MAX_LEVEL);
/** Plafond de récompenses bonus par saison (50 000 XP après le niveau 100). */
export const PASS_BONUS_MAX = 20;
/** Récompense de chaque tranche bonus. */
export const PASS_BONUS_REWARD: PassReward = { pw: 0, packs: 1 };

export interface PassBonusProgress {
  /** Récompenses bonus gagnées cette saison (au plus `PASS_BONUS_MAX`). */
  count: number;
  /** XP gagnée dans la tranche en cours. */
  into: number;
  /** XP de la tranche en cours (0 une fois le plafond atteint). */
  need: number;
}

/** Avancement des récompenses bonus pour une XP de saison (rien avant le niveau 100). */
export function passBonus(xp: number): PassBonusProgress {
  const extra = Math.max(0, xp - xpToReach(PASS_MAX_LEVEL));
  const count = Math.min(PASS_BONUS_MAX, Math.floor(extra / PASS_BONUS_XP));
  if (count >= PASS_BONUS_MAX) return { count, into: 0, need: 0 };
  return { count, into: extra - count * PASS_BONUS_XP, need: PASS_BONUS_XP };
}

/** XP gagnée par événement (les quêtes ajoutent la leur à part). */
export const XP = {
  pack: 10,
  themedPack: 25,
  wheel: 20,
  login: 25,
  battleWin: 40,
  battleLoss: 15,
  articleFound: 150,
  articlePlayed: 30,
  bossAssault: 60,
  /** Par phase du boss dont on touche la récompense (deux phases : l'ancienne chute, 300 XP). */
  bossPhase: 150,
  upgrade: 10,
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
    case "article_played":
      return e.found ? XP.articleFound : XP.articlePlayed;
    case "boss_assault":
      return XP.bossAssault;
    case "boss_phase":
      return XP.bossPhase;
    case "upgrade":
      return XP.upgrade;
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
