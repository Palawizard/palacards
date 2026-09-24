import { describe, expect, it } from "vitest";
import {
  BATTLE_REWARDED_PER_PAIR_PER_DAY,
  battleOver,
  battleRated,
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

  it("met l'autre carte de la manche parmi les leurres de « Qui suis-je ? »", () => {
    for (let r = 1; r <= 30; r++) {
      const q = makeQuestion(`k-${r}`, r, eiffel, mont, decoys);
      if (q.type === "who_am_i") expect(q.choices).toContain("Mont Blanc");
    }
  });

  it("ne pose jamais une question à deux choix identiques (même article des deux côtés)", () => {
    const twin = card({ title: "Paris", views12m: 5, pageLen: 9, extract: null });
    const q = makeQuestion("t", 1, twin, { ...twin, cardId: 2 }, ["Lyon", "Nice", "Lille", "Brest"]);
    expect(new Set(q.choices).size).toBe(q.choices.length);
    expect(q.choices[q.answer]).toBe("Paris");
  });

  it("se replie sur « plus lu » sans résumé ni leurres", () => {
    const q = makeQuestion("x", 1, card({ title: "A", views12m: 5, pageLen: 1 }), card({ title: "B", views12m: 9, pageLen: 1 }), []);
    expect(q.type).toBe("most_viewed");
    expect(q.choices[q.answer]).toBe("B");
  });

  it("manche rejouée : change de type de question quand c'est possible", () => {
    const a = card({ title: "A", views12m: 5, pageLen: 10 });
    const b = card({ title: "B", views12m: 9, pageLen: 1 });
    for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
      const first = makeQuestion(seed, 2, a, b, []);
      const again = makeQuestion(`${seed}:bis`, 2, a, b, [], first);
      expect(again.type).not.toBe(first.type);
      expect(again.choices[again.answer]).toBe(again.type === "longest" ? "A" : "B");
    }
    // Un seul type possible : on le garde (rien d'autre à poser).
    const only = makeQuestion("x", 1, card({ title: "A", views12m: 5, pageLen: 1 }), card({ title: "B", views12m: 9, pageLen: 1 }), []);
    expect(makeQuestion("y", 1, card({ title: "A", views12m: 5, pageLen: 1 }), card({ title: "B", views12m: 9, pageLen: 1 }), [], only).type).toBe("most_viewed");
  });

  it("manche rejouée en « Qui suis-je ? » : l'autre article devient la cible", () => {
    const extract = (t: string) => `${t} est un lieu très connu, décrit ici par une phrase assez longue pour servir de résumé.`;
    const a = card({ title: "Alpha", views12m: 1, pageLen: 1, extract: extract("Alpha") });
    const b = card({ title: "Bravo", views12m: 1, pageLen: 1, extract: extract("Bravo") });
    const first = makeQuestion("seed", 1, a, b, decoys);
    expect(first.type).toBe("who_am_i");
    const again = makeQuestion("seed:bis", 1, a, b, decoys, first);
    expect(again.type).toBe("who_am_i");
    expect(again.choices[again.answer]).not.toBe(first.choices[first.answer]);
    // Sans question à éviter, la génération ne change pas (même graine → même question).
    expect(makeQuestion("seed", 1, a, b, decoys)).toEqual(first);
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

  it("Elo : plafond quotidien par paire et rien si le perdant n'a pas joué", () => {
    const base = { pairFinishedToday: 0, result: 1 as const, answered1: true, answered2: true };
    expect(battleRated(base)).toBe(true);
    expect(battleRated({ ...base, pairFinishedToday: BATTLE_REWARDED_PER_PAIR_PER_DAY - 1 })).toBe(true);
    expect(battleRated({ ...base, pairFinishedToday: BATTLE_REWARDED_PER_PAIR_PER_DAY })).toBe(false);
    // Perdant absent (abandon, compte secondaire inactif) : pas d'Elo.
    expect(battleRated({ ...base, answered2: false })).toBe(false);
    expect(battleRated({ ...base, result: 2, answered1: false })).toBe(false);
    // Gagnant absent mais perdant actif : le perdant a vraiment joué et perdu.
    expect(battleRated({ ...base, answered1: false })).toBe(true);
    // Nul : il faut que les deux aient joué.
    expect(battleRated({ ...base, result: 0, answered2: false })).toBe(false);
    expect(battleRated({ ...base, result: 0 })).toBe(true);
  });

  it("récompense victoire, défaite et nul", () => {
    expect(battleReward("win")).toBe(ECONOMY.battle.win);
    expect(battleReward("loss")).toBe(ECONOMY.battle.loss);
    expect(battleReward("draw")).toBe(20);
  });
});
