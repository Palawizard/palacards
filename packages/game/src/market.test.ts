import { describe, expect, it } from "vitest";
import { dailyLoginReward, ECONOMY, sellerProceeds } from "./economy.js";
import {
  addDays,
  antiSnipeEnd,
  minNextBid,
  nextLoginStreak,
  parisDay,
  referencePrice,
  saleTax,
  validateListing,
} from "./market.js";

describe("mise en vente", () => {
  const hour = 60 * 60_000;
  it("accepte une annonce valide", () => {
    expect(validateListing(100, null, hour)).toBeNull();
    expect(validateListing(100, 100, 10 * 60_000)).toBeNull();
  });
  it("refuse prix, achat immédiat et durée invalides", () => {
    expect(validateListing(0, null, hour)).toBe("invalid_price");
    expect(validateListing(1.5, null, hour)).toBe("invalid_price");
    expect(validateListing(100, 99, hour)).toBe("buyout_below_start");
    expect(validateListing(100, null, 2 * hour)).toBe("invalid_duration");
  });
});

describe("enchères", () => {
  it("impose la mise à prix puis +5 % (au moins +1)", () => {
    expect(minNextBid(50, null)).toBe(50);
    expect(minNextBid(50, 10)).toBe(11);
    expect(minNextBid(50, 100)).toBe(105);
    expect(minNextBid(50, 101)).toBe(107);
  });

  it("anti-snipe : une offre dans la dernière minute prolonge la vente de 60 s", () => {
    const end = new Date("2026-01-01T12:00:00Z");
    const early = new Date(end.getTime() - 5 * 60_000);
    expect(antiSnipeEnd(end, early)).toEqual(end);
    const late = new Date(end.getTime() - 10_000);
    expect(antiSnipeEnd(end, late).getTime()).toBe(end.getTime() + ECONOMY.auctionAntiSnipeMs);
    const edge = new Date(end.getTime() - 60_000);
    expect(antiSnipeEnd(end, edge).getTime()).toBe(end.getTime() + ECONOMY.auctionAntiSnipeMs);
  });

  it("taxe de 5 % arrondie en défaveur du vendeur", () => {
    expect(saleTax(100)).toBe(5);
    expect(saleTax(101)).toBe(6);
    expect(sellerProceeds(101)).toBe(95);
    expect(saleTax(1)).toBe(1);
  });
});

describe("prix de référence", () => {
  it("médiane, min et max des 20 dernières ventes", () => {
    expect(referencePrice([])).toBeNull();
    expect(referencePrice([10, 30, 20])).toEqual({ median: 20, min: 10, max: 30, count: 3 });
    expect(referencePrice([10, 20])).toEqual({ median: 15, min: 10, max: 20, count: 2 });
    const many = Array.from({ length: 30 }, (_, i) => (i < 20 ? 100 : 1_000_000));
    expect(referencePrice(many)).toEqual({ median: 100, min: 100, max: 100, count: 20 });
  });
});

describe("connexion quotidienne", () => {
  it("fait grimper la série jour après jour, et repart à 1 après un trou", () => {
    expect(nextLoginStreak(null, "2026-09-01", 0)).toBe(1);
    expect(nextLoginStreak("2026-09-01", "2026-09-01", 1)).toBeNull();
    expect(nextLoginStreak("2026-09-30", "2026-10-01", 4)).toBe(5);
    expect(nextLoginStreak("2026-09-28", "2026-10-01", 4)).toBe(1);
  });
  it("récompense 20 PW +5 par jour de série, plafonnée à 50", () => {
    expect(dailyLoginReward(1)).toBe(20);
    expect(dailyLoginReward(3)).toBe(30);
    expect(dailyLoginReward(30)).toBe(50);
  });
  it("calcule les jours à l'heure de Paris", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(parisDay(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
  });
});
