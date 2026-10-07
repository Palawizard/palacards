import type { Rarity } from "./rarity.js";

/** Tous les montants de l'économie, en points wiki (PW). À ajuster ici uniquement. */
export const ECONOMY = {
  recycleValue: { C: 1, PC: 3, R: 10, SR: 40, UR: 150, L: 1_000 } satisfies Record<Rarity, number>,
  dailyLogin: { base: 20, perStreakDay: 5, max: 50 },
  /**
   * Bonus de retour, versé avec le bonus du jour après une longue absence. Rien n'est pris aux absents.
   * Toujours inférieur aux bonus du jour manqués pendant l'absence : s'absenter exprès n'y gagne rien.
   */
  returnBonus: { minDaysAway: 14, reward: 150 },
  battle: { win: 30, loss: 10 },
  startingBalance: 100,
  bonusPackPrice: 150,
  /** Prix par défaut d'un booster à thème (réglable par thème dans l'admin). */
  themePackPrice: 250,
  marketTaxRate: 0.05,
  auctionListingFee: 2,
  auctionAntiSnipeMs: 60_000,
  auctionDurationsMs: [10 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000],
  referencePriceSampleSize: 20,
} as const;

export function dailyLoginReward(streakDays: number): number {
  const { base, perStreakDay, max } = ECONOMY.dailyLogin;
  return Math.min(max, base + perStreakDay * Math.max(0, streakDays - 1));
}

/**
 * Bonus de retour : `reward` PW si la dernière connexion date d'au moins `minDaysAway` jours
 * (jours calendaires). Rien pour un nouveau compte (pas de connexion précédente).
 */
export function returnBonus(lastLoginDay: string | null, today: string): number {
  if (!lastLoginDay) return 0;
  const { minDaysAway, reward } = ECONOMY.returnBonus;
  const away = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastLoginDay}T00:00:00Z`)) / 86_400_000;
  return away >= minDaysAway ? reward : 0;
}

/** Montant réellement reçu par le vendeur après la taxe (arrondi en défaveur du vendeur). */
export function sellerProceeds(price: number): number {
  return price - Math.ceil(price * ECONOMY.marketTaxRate);
}
