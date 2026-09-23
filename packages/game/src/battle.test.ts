import { describe, expect, it } from "vitest";
import {
  battleOver,
  battleResult,
  battleReward,
  eloUpdate,
  makeQuestion,
  maskExtract,
  roundPower,
  roundWinner,
  seededRandom,
  type QuizCard,
} from "./battle.js";
import { ECONOMY } from "./economy.js";

const card = (over: Partial<QuizCard>): QuizCard => ({ cardId: 1, title: "Paris", views12m: 100, pageLen: 1000, extract: null, ...over });

describe("aléatoire à graine", () => {
  it("est déterministe et varie selon la graine", () => {
    const a = seededRandom("duel-42");
    const b = seededRandom("duel-42");
    const c = seededRandom("duel-43");
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("questions", () => {
  const eiffel = card({
    cardId: 1,
    title: "Tour Eiffel",
    views12m: 900,
    pageLen: 5000,
    extract: "La tour Eiffel est une tour de fer puddlé de 330 mètres de hauteur située à Paris, à l'extrémité nord-ouest du parc du Champ-de-Mars.",
  });
  const mont = card({ cardId: 2, title: "Mont Blanc", views12m: 400, pageLen: 8000, extract: null });
  const decoys = ["Arc de triomphe", "Louvre", "Notre-Dame de Paris", "Sacré-Cœur"];

  it("donne la même question aux deux joueurs (même graine)", () => {
    expect(makeQuestion("s", 1, eiffel, mont, decoys)).toEqual(makeQuestion("s", 1, eiffel, mont, decoys));
  });

  it("produit des questions valides avec la bonne réponse parmi les choix", () => {
    for (let r = 1; r <= 30; r++) {
      const q = makeQuestion(`seed-${r}`, r, eiffel, mont, decoys);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.choices.length);
      if (q.type === "most_viewed") expect(q.choices[q.answer]).toBe("Tour Eiffel");
      if (q.type === "longest") expect(q.choices[q.answer]).toBe("Mont Blanc");
      if (q.type === "who_am_i") {
        expect(q.choices).toHaveLength(4);
        expect(q.choices[q.answer]).toBe("Tour Eiffel");
        expect(q.prompt.toLowerCase()).not.toContain("eiffel");
      }
    }
  });

  it("se replie sur « plus lu » sans résumé ni leurres", () => {
    const q = makeQuestion("x", 1, card({ title: "A", views12m: 5, pageLen: 1 }), card({ title: "B", views12m: 9, pageLen: 1 }), []);
    expect(q.type).toBe("most_viewed");
    expect(q.choices[q.answer]).toBe("B");
  });

  it("masque le titre dans le résumé et le tronque", () => {
    const masked = maskExtract("Albert Einstein est un physicien. Einstein a publié la relativité.", "Albert Einstein");
    expect(masked).not.toMatch(/einstein/i);
    expect(maskExtract("mot ".repeat(200), "X").length).toBeLessThanOrEqual(261);
  });
});

describe("combat", () => {
  it("applique la formule de puissance (bonus de vitesse seulement si juste)", () => {
    expect(roundPower(1000, 1000, true, 10_000)).toBe(1000 * 1.75 - 300);
    expect(roundPower(1000, 1000, true, 0)).toBe(1000 * 1.5 - 300);
    expect(roundPower(1000, 1000, false, 10_000)).toBe(700);
    expect(roundPower(1000, 0, true, 5_000)).toBe(1625);
  });

  it("départage à la DEF puis déclare la manche nulle", () => {
    expect(roundWinner({ power: 10, def: 1 }, { power: 9, def: 99 })).toBe(1);
    expect(roundWinner({ power: 10, def: 1 }, { power: 10, def: 2 })).toBe(2);
    expect(roundWinner({ power: 10, def: 2 }, { power: 10, def: 2 })).toBe(0);
  });

  it("s'arrête à 3 manches gagnées ou après 5", () => {
    expect(battleOver(3, 0, 3)).toBe(true);
    expect(battleOver(2, 2, 4)).toBe(false);
    expect(battleOver(2, 2, 5)).toBe(true);
    expect(battleResult(2, 2, 5000, 4000)).toBe(1);
    expect(battleResult(2, 2, 10, 10)).toBe(0);
  });

  it("met à jour l'Elo avec K = 32", () => {
    expect(eloUpdate(1000, 1000, 1)).toEqual({ r1: 1016, r2: 984 });
    expect(eloUpdate(1000, 1000, 0.5)).toEqual({ r1: 1000, r2: 1000 });
    const upset = eloUpdate(1000, 1400, 1);
    expect(upset.r1 - 1000).toBe(29);
  });

  it("récompense victoire, défaite et nul", () => {
    expect(battleReward("win")).toBe(ECONOMY.battle.win);
    expect(battleReward("loss")).toBe(ECONOMY.battle.loss);
    expect(battleReward("draw")).toBe(20);
  });
});
