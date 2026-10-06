import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CARDS_PER_PACK,
  DROP_TABLE_GUARANTEED,
  DROP_TABLE_PITY,
  DROP_TABLE_STANDARD,
  DROP_TABLE_THEMED,
  DROP_TABLE_THEMED_GUARANTEED,
  DROP_TABLE_TOTAL,
  MAX_STORED_PACKS,
  PACK_REGEN_MS,
  PITY_THRESHOLD,
  availablePacks,
  consumeFreePack,
  expectedPackPoints,
  msUntilNextPack,
  packTables,
  pulledPackPoints,
  rollPack,
} from "./packs.js";
import { RARITIES, rarityFromViewRank, type Rarity } from "./rarity.js";

const sum = (t: Record<Rarity, number>) => RARITIES.reduce((acc, r) => acc + t[r], 0);

describe("tables de drop", () => {
  it.each([
    ["standard", DROP_TABLE_STANDARD],
    ["garantie", DROP_TABLE_GUARANTEED],
    ["pity", DROP_TABLE_PITY],
    ["thème", DROP_TABLE_THEMED],
    ["thème garantie", DROP_TABLE_THEMED_GUARANTEED],
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
      res.rarities.slice(0, CARDS_PER_PACK - 1).forEach((r) => counts[r]++);
    }
    const slots = packs * (CARDS_PER_PACK - 1);
    expect(counts.C / slots).toBeCloseTo(0.62, 2);
    expect(counts.PC / slots).toBeCloseTo(0.25, 2);
    expect(counts.R / slots).toBeCloseTo(0.095, 2);
  });
});

describe("booster à thème", () => {
  it("a de meilleurs taux que le paquet standard à partir de Rare (Super rare sur la dernière carte)", () => {
    for (const r of ["R", "SR", "UR", "L"] as const)
      expect(DROP_TABLE_THEMED[r]).toBeGreaterThan(DROP_TABLE_STANDARD[r]);
    for (const r of ["SR", "UR", "L"] as const)
      expect(DROP_TABLE_THEMED_GUARANTEED[r]).toBeGreaterThan(DROP_TABLE_GUARANTEED[r]);
  });

  it("garde la garantie Rare ou mieux et la pity", () => {
    const { rarities, pityCounter } = rollPack(PITY_THRESHOLD, randomInt, "themed");
    expect(["UR", "L"]).toContain(rarities[CARDS_PER_PACK - 1]);
    expect(pityCounter).toBe(0);
    const last = rollPack(0, () => 0, "themed").rarities[CARDS_PER_PACK - 1];
    expect(["R", "SR", "UR", "L"]).toContain(last);
  });

  it("sans légendaire : jamais de L, son poids passe sur UR (pity comprise)", () => {
    const { table, last, pity } = packTables("themed", true);
    for (const t of [table, last, pity]) {
      expect(sum(t)).toBe(DROP_TABLE_TOTAL);
      expect(t.L).toBe(0);
    }
    expect(table.UR).toBe(DROP_TABLE_THEMED.UR + DROP_TABLE_THEMED.L);
    expect(table.SR).toBe(DROP_TABLE_THEMED.SR);
    expect(pity.UR).toBe(DROP_TABLE_TOTAL);
    // Tirage le plus bas : L d'ordinaire, UR ici.
    expect(rollPack(0, () => 0, "themed").rarities).toContain("L");
    const low = rollPack(PITY_THRESHOLD, () => 0, "themed", true);
    expect(low.rarities.every((r) => r === "UR")).toBe(true);
    expect(low.pityCounter).toBe(0);
    for (let i = 0; i < 2_000; i++) expect(rollPack(i % 60, randomInt, "themed", true).rarities).not.toContain("L");
  });

  it("sans légendaire : espérance de points plus basse", () => {
    expect(expectedPackPoints("themed", false, true)).toBeLessThan(expectedPackPoints("themed"));
    expect(expectedPackPoints("themed", true, true)).toBeLessThan(expectedPackPoints("themed", true));
  });
});

describe("rollPack", () => {
  it("donne 10 cartes dont la dernière est au moins Rare", () => {
    const { rarities } = rollPack(0, randomInt);
    expect(rarities).toHaveLength(CARDS_PER_PACK);
    expect(CARDS_PER_PACK).toBe(10);
    expect(["R", "SR", "UR", "L"]).toContain(rarities.at(-1));
  });

  it("déclenche la pity au seuil et remet le compteur à 0", () => {
    const { rarities, pityCounter } = rollPack(PITY_THRESHOLD, randomInt);
    expect(["UR", "L"]).toContain(rarities.at(-1));
    expect(pityCounter).toBe(0);
  });
});

describe("minuteur de paquets", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const after = (ms: number) => new Date(t0.getTime() + ms);

  it("ajoute un paquet toutes les 10 minutes", () => {
    expect(availablePacks(3, t0, after(PACK_REGEN_MS * 2 + 1))).toBe(5);
  });

  it("plafonne à 30", () => {
    expect(MAX_STORED_PACKS).toBe(30);
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

describe("consumeFreePack", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const after = (ms: number) => new Date(t0.getTime() + ms);

  it("garde la progression du minuteur", () => {
    const now = after(PACK_REGEN_MS * 2 + 5 * 60_000); // 25 min : 3 + 2 = 5 dispo
    const res = consumeFreePack(3, t0, now);
    expect(res?.stored).toBe(4);
    expect(msUntilNextPack(res!.stored, res!.updatedAt, now)).toBe(5 * 60_000);
  });

  it("relance le minuteur quand le stock était plein", () => {
    const now = after(PACK_REGEN_MS * 50);
    const res = consumeFreePack(MAX_STORED_PACKS, t0, now);
    expect(res).toEqual({ stored: MAX_STORED_PACKS - 1, updatedAt: now });
    expect(msUntilNextPack(res!.stored, res!.updatedAt, now)).toBe(PACK_REGEN_MS);
  });

  it("renvoie null sans paquet", () => {
    expect(consumeFreePack(0, t0, after(60_000))).toBeNull();
  });
});

describe("chance : espérance de points d'un paquet", () => {
  it("vaut ~39,7 points pour un paquet standard, ~88,5 pour un booster à thème, plus avec la pity", () => {
    expect(expectedPackPoints("standard")).toBe(396_550);
    expect(expectedPackPoints("themed")).toBe(885_000);
    expect(expectedPackPoints("standard", true)).toBe(9 * 33_250 + 1_252_000);
    expect(pulledPackPoints(["C", "PC", "L"])).toBe(1_003 * DROP_TABLE_TOTAL);
  });

  it("colle à la moyenne des tirages simulés (chance moyenne ≈ 100 %)", () => {
    let pity = 0;
    let pulled = 0;
    let expected = 0;
    for (let i = 0; i < 200_000; i++) {
      expected += expectedPackPoints("standard", pity >= PITY_THRESHOLD);
      const res = rollPack(pity, randomInt);
      pity = res.pityCounter;
      pulled += pulledPackPoints(res.rarities);
    }
    expect(pulled / expected).toBeGreaterThan(0.95);
    expect(pulled / expected).toBeLessThan(1.05);
  });
});
