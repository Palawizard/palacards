import type { Rarity } from "./rarity.js";

/** Montants du bonus de connexion quotidienne : base au premier jour, + par jour de série, plafond. */
export interface DailyLoginRates {
  base: number;
  perStreakDay: number;
  max: number;
}

/** Bonus de connexion du lancement du jeu (20 PW, +5 par jour de série, max 50). */
export const DAILY_LOGIN_LAUNCH: DailyLoginRates = { base: 20, perStreakDay: 5, max: 50 };
/** Revalorisation par défaut des montants du lancement (+50 %), appliquée à chaque palier. */
export const DAILY_LOGIN_BOOST = 1.5;
/** Plafond de chaque réglage du bonus de connexion dans la page Admin, en PW. */
export const DAILY_LOGIN_MAX_PW = 1_000;
/** Nombre de jours de série montrés dans l'aperçu de la page Admin. */
export const DAILY_LOGIN_PREVIEW_DAYS = 7;

const boosted = (pw: number) => Math.round(pw * DAILY_LOGIN_BOOST);

/** Tous les montants de l'économie, en points wiki (PW). À ajuster ici uniquement. */
export const ECONOMY = {
  recycleValue: { C: 1, PC: 3, R: 10, SR: 40, UR: 150, L: 1_000 } satisfies Record<Rarity, number>,
  /** Valeurs par défaut, remplacées par le réglage de la page Admin s'il existe. */
  dailyLogin: {
    base: boosted(DAILY_LOGIN_LAUNCH.base),
    perStreakDay: boosted(DAILY_LOGIN_LAUNCH.perStreakDay),
    max: boosted(DAILY_LOGIN_LAUNCH.max),
  } satisfies DailyLoginRates,
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

export function dailyLoginReward(streakDays: number, rates: DailyLoginRates = ECONOMY.dailyLogin): number {
  const { base, perStreakDay, max } = rates;
  return Math.min(max, base + perStreakDay * Math.max(0, streakDays - 1));
}

/** Bonus reçus les premiers jours d'une série (aperçu de la page Admin). */
export function dailyLoginSchedule(rates: DailyLoginRates, days = DAILY_LOGIN_PREVIEW_DAYS): number[] {
  return Array.from({ length: days }, (_, i) => dailyLoginReward(i + 1, rates));
}

/** Montant réellement reçu par le vendeur après la taxe (arrondi en défaveur du vendeur). */
export function sellerProceeds(price: number): number {
  return price - Math.ceil(price * ECONOMY.marketTaxRate);
}
