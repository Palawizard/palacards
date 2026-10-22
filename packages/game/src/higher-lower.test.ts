import { describe, expect, it } from "vitest";
import { seededRandom } from "./battle.js";
import {
  HL_MIN_RATIO,
  hlBand,
  hlCorrect,
  hlEligibleDescription,
  hlEligibleTitle,
  hlExpired,
  hlReward,
  hlShareText,
  hlViewRange,
  hlWidenedBands,
  pickChallenger,
} from "./higher-lower.js";
import type { RandomInt } from "./packs.js";

const seeded = (seed: string): RandomInt => {
  const next = seededRandom(seed);
  return (max) => Math.floor(next() * max);
};

describe("plus ou moins vu : récompenses", () => {
  it("suit le barème jusqu'à 10, puis +60 par réussite, plafonné à 25 réussites", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(hlReward)).toEqual([0, 10, 25, 45, 70, 100, 135, 175, 220, 270, 325]);
    expect(hlReward(11)).toBe(385);
    expect(hlReward(25)).toBe(1_225);
    expect(hlReward(40)).toBe(1_225);
    expect(hlReward(-3)).toBe(0);
  });

  it("donne environ 52 PW par essai au joueur moyen de la simulation", () => {
    const p = (s: number) => (s <= 2 ? 0.75 : s <= 5 ? 0.68 : s <= 9 ? 0.62 : 0.58);
    let alive = 1;
    let expected = 0;
    let streak = 0;
    for (let s = 0; s < 200; s++) {
      const stop = alive * (1 - p(s));
      expected += stop * hlReward(s);
      streak += stop * s;
      alive *= p(s);
    }
    expect(streak).toBeCloseTo(2.56, 1);
    expect(expected).toBeGreaterThan(50);
    expect(expected).toBeLessThan(54);
  });
});

describe("plus ou moins vu : difficulté", () => {
  it("resserre l'écart de vues avec la série", () => {
    expect([0, 2].map((s) => hlBand(s))).toEqual([
      { upTo: 2, min: 2, max: 20 },
      { upTo: 2, min: 2, max: 20 },
    ]);
    expect(hlBand(3)).toMatchObject({ min: 1.4, max: 3 });
    expect(hlBand(5)).toMatchObject({ min: 1.4, max: 3 });
    expect(hlBand(6)).toMatchObject({ min: 1.15, max: 1.8 });
    expect(hlBand(9)).toMatchObject({ min: 1.15, max: 1.8 });
    expect(hlBand(10)).toMatchObject({ min: 1.05, max: 1.4 });
    expect(hlBand(42)).toMatchObject({ min: 1.05, max: 1.4 });
  });

  it("élargit la fourchette petit à petit, jamais sous ×1,05", () => {
    const bands = hlWidenedBands(0);
    expect(bands[0]).toEqual({ min: 2, max: 20 });
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]!.min).toBeLessThanOrEqual(bands[i - 1]!.min);
      expect(bands[i]!.max).toBeGreaterThanOrEqual(bands[i - 1]!.max);
      expect(bands[i]!.min).toBeGreaterThanOrEqual(HL_MIN_RATIO);
    }
    expect(bands.at(-1)).toEqual({ min: HL_MIN_RATIO, max: Infinity });
  });

  it("cherche les vues dans la bonne fourchette, au-dessus ou en dessous", () => {
    expect(hlViewRange(100_000, { min: 2, max: 20 }, true)).toEqual({ from: 200_000, to: 2_000_000 });
    expect(hlViewRange(100_000, { min: 2, max: 20 }, false)).toEqual({ from: 5_000, to: 50_000 });
  });

  it("choisit un nouvel article dans la fourchette, 50 % plus vu, jamais à égalité", () => {
    const candidates = [10_000, 30_000, 60_000, 95_000, 100_000, 103_000, 160_000, 400_000, 900_000].map(
      (views, id) => ({
        id,
        views,
      }),
    );
    let higher = 0;
    const random = seeded("challenger");
    for (let i = 0; i < 2_000; i++) {
      const c = pickChallenger(100_000, candidates, 0, random)!;
      const r = Math.max(c.views, 100_000) / Math.min(c.views, 100_000);
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThanOrEqual(20);
      if (c.views > 100_000) higher++;
    }
    expect(higher / 2_000).toBeGreaterThan(0.45);
    expect(higher / 2_000).toBeLessThan(0.55);
    // Série de 10 : ×1,05 à ×1,4 seulement (95 000 ou 103 000 vues ici).
    for (let i = 0; i < 200; i++) {
      const c = pickChallenger(100_000, candidates, 10, random)!;
      const r = Math.max(c.views, 100_000) / Math.min(c.views, 100_000);
      expect(r).toBeGreaterThanOrEqual(1.05);
      expect(r).toBeLessThanOrEqual(1.4);
    }
  });

  it("élargit si rien ne convient, et renvoie null sans candidat possible", () => {
    const random = seeded("large");
    // Seul candidat : ×1,1, hors de la fourchette ×2 à ×20 de la série 0.
    expect(pickChallenger(100_000, [{ views: 110_000 }], 0, random)).toEqual({ views: 110_000 });
    // Égalité ou presque (×1,02) : jamais.
    expect(pickChallenger(100_000, [{ views: 100_000 }, { views: 102_000 }], 0, random)).toBeNull();
    expect(pickChallenger(100_000, [], 0, random)).toBeNull();
  });
});

describe("plus ou moins vu : réponses et pool", () => {
  it("bonne réponse : strictement plus de vues ; échéance avec 1 s de marge", () => {
    expect(hlCorrect(200, 100)).toBe(true);
    expect(hlCorrect(100, 200)).toBe(false);
    const deadline = new Date("2026-10-22T10:00:15Z");
    expect(hlExpired(deadline, new Date("2026-10-22T10:00:15.900Z"))).toBe(false);
    expect(hlExpired(deadline, new Date("2026-10-22T10:00:16.100Z"))).toBe(true);
  });

  it("écarte les listes et les pages d'homonymie", () => {
    expect(hlEligibleTitle("Liste des communes de France")).toBe(false);
    expect(hlEligibleTitle("Liste d'aéroports")).toBe(false);
    expect(hlEligibleTitle("Mercure (homonymie)")).toBe(false);
    expect(hlEligibleTitle("Listeria")).toBe(true);
    expect(hlEligibleTitle("Tour Eiffel")).toBe(true);
    expect(hlEligibleDescription("page d'homonymie de Wikimedia")).toBe(false);
    expect(hlEligibleDescription("monument de Paris")).toBe(true);
    expect(hlEligibleDescription(null)).toBe(true);
  });

  it("partage sans spoiler : séries du jour et record, aucun titre", () => {
    const text = hlShareText("2026-10-22", [3, 0, 12], 14);
    expect(text).toContain("Meilleure série du jour : 12");
    expect(text).toContain("record : 14");
    expect(text.split("\n")).toHaveLength(5);
  });
});
