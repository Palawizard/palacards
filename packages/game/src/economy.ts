import type { Rarity } from "./rarity.js";

/** Tous les montants de l'économie, en points wiki (PW). À ajuster ici uniquement. */
export const ECONOMY = {
  recycleValue: { C: 1, PC: 3, R: 10, SR: 40, UR: 150, L: 1_000 } satisfies Record<Rarity, number>,
  dailyLogin: { base: 20, perStreakDay: 5, max: 50 },
  battle: { win: 30, loss: 10 },
  bonusPackPrice: 150,
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

/** Montant réellement reçu par le vendeur après la taxe (arrondi en défaveur du vendeur). */
export function sellerProceeds(price: number): number {
  return price - Math.ceil(price * ECONOMY.marketTaxRate);
}
