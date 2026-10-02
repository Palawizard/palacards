import { PERFECT_PARRY_MS } from "./battle.js";

// ---------------------------------------------------------------------------
// Boss du jour (coopératif) : une Légendaire de la saison, la même pour tout le monde, avec des PV partagés.
// Chaque joueur a 2 assauts par jour ; un assaut = 5 cartes de sa collection, 5 questions sur leurs
// articles. Bonne réponse : la carte frappe (40 + ATK ÷ 100) ; en moins de 4 s, coup critique (×1,5).
//
// Équilibrage : une carte moyenne (≈ 2 500 ATK) frappe à 65 ; avec ~65 % de bonnes réponses dont un quart
// de critiques, un assaut fait ≈ 250 dégâts, soit ≈ 500 par joueur et par jour. 4 000 PV : dix joueurs
// actifs le tombent largement, sept ou huit bons joueurs aussi.
// ---------------------------------------------------------------------------

export const BOSS_MAX_HP = 4_000;
export const BOSS_ASSAULTS_PER_DAY = 2;
export const BOSS_CARDS_PER_ASSAULT = 5;
export const BOSS_QUESTION_MS = 12_000;
/** Marge réseau tolérée au-delà du chrono. */
export const BOSS_ANSWER_GRACE_MS = 1_500;
export const BOSS_CRIT_MS = PERFECT_PARRY_MS;
export const BOSS_CRIT_MULT = 1.5;

/** Récompenses : à la chute du boss pour chaque participant, bonus au meilleur assaillant, lot de consolation. */
export const BOSS_REWARDS = {
  kill: { pw: 100, packs: 2 },
  mvpPacks: 1,
  consolationPw: 30,
} as const;

/** Dégâts d'une carte qui touche, avant critique (41 à 140). */
export function bossHitBase(atk: number): number {
  return Math.round(40 + Math.max(0, atk) / 100);
}

export type BossHit = "miss" | "hit" | "crit";

export function bossHit(correct: boolean, answerMs: number | null): BossHit {
  if (!correct || answerMs === null) return "miss";
  return answerMs <= BOSS_CRIT_MS ? "crit" : "hit";
}

export function bossDamage(atk: number, hit: BossHit): number {
  if (hit === "miss") return 0;
  const base = bossHitBase(atk);
  return hit === "crit" ? Math.round(base * BOSS_CRIT_MULT) : base;
}
