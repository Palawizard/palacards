import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DROP_TABLE_GUARANTEED,
  DROP_TABLE_PITY,
  DROP_TABLE_STANDARD,
  DROP_TABLE_TOTAL,
  MAX_STORED_PACKS,
  PACK_REGEN_MS,
  PITY_THRESHOLD,
  availablePacks,
  msUntilNextPack,
  rollPack,
} from "./packs.js";
import { RARITIES, rarityFromViewRank, type Rarity } from "./rarity.js";

const sum = (t: Record<Rarity, number>) => RARITIES.reduce((acc, r) => acc + t[r], 0);

describe("tables de drop", () => {
  it.each([
    ["standard", DROP_TABLE_STANDARD],
    ["garantie", DROP_TABLE_GUARANTEED],
    ["pity", DROP_TABLE_PITY],
  ])("la table %s somme à 10 000", (_, table) => {
    expect(sum(table)).toBe(DROP_TABLE_TOTAL);
  });

  it("colle aux taux cibles sur 100 000 paquets", () => {
    const counts: Record<Rarity, number> = { C: 0, PC: 0, R: 0, SR: 0, UR: 0, L: 0 };
    let pity = 0;
    const packs = 100_000;
    for (let i = 0; i < packs; i++) {
      const res = rollPack(pity, randomInt);
      pity = res.pityCounter;
      res.rarities.slice(0, 4).forEach((r) => counts[r]++);
    }
    const slots = packs * 4;
    expect(counts.C / slots).toBeCloseTo(0.62, 2);
    expect(counts.PC / slots).toBeCloseTo(0.25, 2);
    expect(counts.R / slots).toBeCloseTo(0.095, 2);
  });
});

describe("rollPack", () => {
  it("donne 5 cartes dont la dernière est au moins Rare", () => {
    const { rarities } = rollPack(0, randomInt);
    expect(rarities).toHaveLength(5);
    expect(["R", "SR", "UR", "L"]).toContain(rarities[4]);
  });

  it("déclenche la pity au seuil et remet le compteur à 0", () => {
    const { rarities, pityCounter } = rollPack(PITY_THRESHOLD, randomInt);
    expect(["UR", "L"]).toContain(rarities[4]);
    expect(pityCounter).toBe(0);
  });
});

describe("minuteur de paquets", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const after = (ms: number) => new Date(t0.getTime() + ms);

  it("ajoute un paquet toutes les 10 minutes", () => {
    expect(availablePacks(3, t0, after(PACK_REGEN_MS * 2 + 1))).toBe(5);
  });

  it("plafonne à 10", () => {
    expect(availablePacks(8, t0, after(PACK_REGEN_MS * 50))).toBe(MAX_STORED_PACKS);
    expect(msUntilNextPack(8, t0, after(PACK_REGEN_MS * 50))).toBe(0);
  });

  it("calcule le temps restant", () => {
    expect(msUntilNextPack(0, t0, after(60_000))).toBe(PACK_REGEN_MS - 60_000);
  });
});

describe("rarityFromViewRank", () => {
  it.each([
    [1, "L"],
    [1_000, "L"],
    [1_001, "UR"],
    [50_000, "SR"],
    [250_001, "PC"],
    [1_000_001, "C"],
  ] as const)("rang %i → %s", (rank, expected) => {
    expect(rarityFromViewRank(rank)).toBe(expected);
  });
});
