import { ECONOMY } from "./economy.js";

/** Hausse minimale d'une surenchère : 5 % de l'offre en cours, au moins 1 PW. */
export const MIN_BID_INCREMENT_RATE = 0.05;
/** Prix plafond d'une annonce (garde-fou contre les fautes de frappe). */
export const MAX_PRICE = 10_000_000;
/** Durée de vie d'une proposition d'échange. */
export const TRADE_TTL_MS = 72 * 60 * 60_000;
/** Cartes maximum de chaque côté d'un échange. */
export const TRADE_MAX_CARDS_PER_SIDE = 10;

export type AuctionDurationMs = (typeof ECONOMY.auctionDurationsMs)[number];

export function isAuctionDuration(ms: number): ms is AuctionDurationMs {
  return (ECONOMY.auctionDurationsMs as readonly number[]).includes(ms);
}

export type ListingError = "invalid_price" | "buyout_below_start" | "invalid_duration";

/** Vérifie une mise en vente (null si valide). */
export function validateListing(startPrice: number, buyout: number | null, durationMs: number): ListingError | null {
  if (!Number.isInteger(startPrice) || startPrice < 1 || startPrice > MAX_PRICE) return "invalid_price";
  if (buyout !== null && (!Number.isInteger(buyout) || buyout > MAX_PRICE)) return "invalid_price";
  if (buyout !== null && buyout < startPrice) return "buyout_below_start";
  if (!isAuctionDuration(durationMs)) return "invalid_duration";
  return null;
}

/** Offre minimale acceptée : la mise à prix, puis l'offre en cours + 5 % (au moins +1). */
export function minNextBid(startPrice: number, currentBid: number | null): number {
  if (currentBid === null) return startPrice;
  return currentBid + Math.max(1, Math.ceil(currentBid * MIN_BID_INCREMENT_RATE));
}

/**
 * Anti-snipe (docs/07-economie.md) : une offre dans la dernière minute prolonge la vente de 60 s.
 * Renvoie la nouvelle échéance (inchangée si l'offre arrive plus tôt).
 */
export function antiSnipeEnd(endsAt: Date, now: Date): Date {
  const window = ECONOMY.auctionAntiSnipeMs;
  if (endsAt.getTime() - now.getTime() > window) return endsAt;
  return new Date(endsAt.getTime() + window);
}

/** Taxe de 5 % détruite sur une vente (arrondie en défaveur du vendeur). */
export function saleTax(price: number): number {
  return Math.ceil(price * ECONOMY.marketTaxRate);
}

export interface ReferencePrice {
  median: number;
  min: number;
  max: number;
  count: number;
}

/** Prix de référence d'un article : médiane, min et max des 20 dernières ventes (null sans vente). */
export function referencePrice(recentPrices: number[]): ReferencePrice | null {
  const sample = recentPrices.slice(0, ECONOMY.referencePriceSampleSize);
  if (sample.length === 0) return null;
  const sorted = [...sample].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return { median, min: sorted[0]!, max: sorted[sorted.length - 1]!, count: sample.length };
}

/**
 * Série de connexion quotidienne : +1 si le dernier jour de connexion était hier,
 * 1 sinon. `null` si la récompense du jour a déjà été touchée.
 */
export function nextLoginStreak(lastDay: string | null, today: string, streak: number): number | null {
  if (lastDay === today) return null;
  if (lastDay && addDays(lastDay, 1) === today) return streak + 1;
  return 1;
}

/** « 2026-09-30 » + 1 → « 2026-10-01 » (dates calendaires, sans fuseau). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Jour calendaire à Paris (les séries et objectifs suivent l'heure française). */
export function parisDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
