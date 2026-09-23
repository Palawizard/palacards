import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, applyEvent } from "./achievements.js";

const state = (entries: [string, number, boolean?][]) => new Map(entries.map(([k, p, u]) => [k, { progress: p, unlocked: !!u }]));

describe("succès", () => {
  it("définit une vingtaine de succès aux récompenses de 50 à 2 000 PW ou en paquets", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACHIEVEMENTS.map((a) => a.key)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.reward.pw === 0 || (a.reward.pw >= 50 && a.reward.pw <= 2_000)).toBe(true);
      expect(a.reward.pw + a.reward.packs).toBeGreaterThan(0);
    }
  });

  it("débloque le premier paquet et la première Légendaire", () => {
    const up = applyEvent(new Map(), { type: "pack_opened", rarities: ["C", "C", "PC", "R", "L"] });
    const byKey = new Map(up.map((u) => [u.key, u]));
    expect(byKey.get("first_pack")).toEqual({ key: "first_pack", progress: 1, unlocked: true });
    expect(byKey.get("first_l")?.unlocked).toBe(true);
    expect(byKey.get("packs_100")).toEqual({ key: "packs_100", progress: 1, unlocked: false });
    expect(byKey.has("first_sr")).toBe(false);
  });

  it("compte les paquets jusqu'à 100 et ignore les succès déjà débloqués", () => {
    const up = applyEvent(state([["packs_100", 99], ["first_pack", 1, true]]), { type: "pack_opened", rarities: ["C"] });
    expect(up.find((u) => u.key === "packs_100")).toEqual({ key: "packs_100", progress: 100, unlocked: true });
    expect(up.find((u) => u.key === "first_pack")).toBeUndefined();
  });

  it("gère les valeurs absolues (séries, pourcentages, niveaux)", () => {
    const streak = applyEvent(state([["streak_5", 3]]), { type: "battle_finished", won: true, winStreak: 5 });
    expect(streak.find((u) => u.key === "streak_5")?.unlocked).toBe(true);
    expect(streak.find((u) => u.key === "wins_10")?.progress).toBe(1);
    const lost = applyEvent(state([["streak_5", 3]]), { type: "battle_finished", won: false, winStreak: 0 });
    expect(lost.find((u) => u.key === "streak_5")).toBeUndefined();
    const ur = applyEvent(new Map(), { type: "collection", uniqueCards: 10, uniqueLegendary: 0, uniqueUR: 1, totalUR: 9 });
    expect(ur.find((u) => u.key === "ur_10pct")).toEqual({ key: "ur_10pct", progress: 10, unlocked: true });
    expect(applyEvent(new Map(), { type: "card_level", level: 5 }).find((u) => u.key === "level_5")?.unlocked).toBe(true);
  });

  it("ne compte que les ventes à plus de 1 000 PW pour le coup de marteau", () => {
    expect(applyEvent(new Map(), { type: "sale", price: 1_000 }).find((u) => u.key === "big_sale")).toBeUndefined();
    expect(applyEvent(new Map(), { type: "sale", price: 1_001 }).find((u) => u.key === "big_sale")?.unlocked).toBe(true);
  });
});
