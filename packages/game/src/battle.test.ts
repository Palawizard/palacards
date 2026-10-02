import { describe, expect, it } from "vitest";
import {
  attackDamage,
  attackerOfTurn,
  cardHiddenUntilAnswer,
  definitionDecoys,
  descriptionHead,
  BATTLE_REWARDED_PER_PAIR_PER_DAY,
  battleOver,
  battleRated,
  battleResult,
  battleReward,
  eloUpdate,
  makeQuestion,
  maskExtract,
  resolveHit,
  seededRandom,
  shieldPercent,
  titlesClash,
  unusableQuizImage,
  TOTAL_TURNS,
  yearQuestion,
  type QuizArticle,
} from "./battle.js";
import { ECONOMY } from "./economy.js";

const article = (over: Partial<QuizArticle>): QuizArticle => ({
  cardId: 1,
  title: "Paris",
  views12m: 100,
  extract: null,
  description: null,
  thumbUrl: null,
  ...over,
});

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

describe("dégâts", () => {
  it("ATK ÷ 100, au moins 1", () => {
    expect(attackDamage(9_000, "L")).toBe(90);
    expect(attackDamage(2_549, "C")).toBe(25);
    expect(attackDamage(20, "C")).toBe(1);
  });

  it("bouclier : DEF ÷ 200 %, plafonné à 50 %", () => {
    expect(shieldPercent(6_000)).toBe(30);
    expect(shieldPercent(9_999)).toBe(50);
    expect(shieldPercent(12_000)).toBe(50);
    expect(shieldPercent(0)).toBe(0);
  });

  it("mauvaise réponse : dégâts réduits par le bouclier", () => {
    expect(resolveHit({ atk: 9_000, rarity: "L", shieldDef: 6_000, correct: false, answerMs: 3_000 })).toEqual({
      raw: 90,
      shieldPct: 30,
      damage: 63,
      reflected: 0,
      parry: "none",
    });
    expect(resolveHit({ atk: 5_000, rarity: "R", shieldDef: null, correct: false, answerMs: null }).damage).toBe(50);
  });

  it("bonne réponse : parée ; rapide : parade parfaite qui renvoie 20 %", () => {
    expect(resolveHit({ atk: 9_000, rarity: "L", shieldDef: 6_000, correct: true, answerMs: 7_000 })).toMatchObject({
      damage: 0,
      reflected: 0,
      parry: "parry",
    });
    expect(resolveHit({ atk: 9_000, rarity: "L", shieldDef: 6_000, correct: true, answerMs: 3_999 })).toMatchObject({
      damage: 0,
      reflected: 18,
      parry: "perfect",
    });
  });
});

describe("déroulé", () => {
  it("alterne l'attaquant", () => {
    expect([1, 2, 3, 4].map((t) => attackerOfTurn(t, "a", "b"))).toEqual(["a", "b", "a", "b"]);
  });

  it("s'arrête à 0 PV ou après le dernier tour", () => {
    expect(battleOver(100, 100, TOTAL_TURNS - 1)).toBe(false);
    expect(battleOver(100, 100, TOTAL_TURNS)).toBe(true);
    expect(battleOver(0, 40, 3)).toBe(true);
    expect(battleOver(40, -5, 3)).toBe(true);
  });

  it("départage aux PV, puis aux dégâts infligés, sinon nul", () => {
    expect(battleResult(60, 20, 0, 0)).toBe(1);
    expect(battleResult(-10, 0, 50, 0)).toBe(1); // deux à terre : les dégâts infligés départagent
    expect(battleResult(50, 50, 30, 45)).toBe(2);
    expect(battleResult(50, 50, 30, 30)).toBe(0);
  });

  it("met à jour l'Elo avec K = 32", () => {
    expect(eloUpdate(1000, 1000, 1)).toEqual({ r1: 1016, r2: 984 });
    expect(eloUpdate(1000, 1000, 0.5)).toEqual({ r1: 1000, r2: 1000 });
    const upset = eloUpdate(1000, 1400, 1);
    expect(upset.r1 - 1000).toBe(29);
  });

  it("Elo : plafond quotidien par paire et rien si le perdant n'a pas joué", () => {
    const base = { pairFinishedToday: 0, played1: true, played2: true };
    expect(battleRated({ ...base, result: 1 })).toBe(true);
    expect(battleRated({ ...base, result: 1, pairFinishedToday: BATTLE_REWARDED_PER_PAIR_PER_DAY })).toBe(false);
    expect(battleRated({ ...base, result: 1, played2: false })).toBe(false);
    expect(battleRated({ ...base, result: 2, played2: false })).toBe(true);
    expect(battleRated({ ...base, result: 0, played1: false })).toBe(false);
  });

  it("récompense victoire, défaite et nul", () => {
    expect(battleReward("win")).toBe(ECONOMY.battle.win);
    expect(battleReward("loss")).toBe(ECONOMY.battle.loss);
    expect(battleReward("draw")).toBe(Math.round((ECONOMY.battle.win + ECONOMY.battle.loss) / 2));
  });
});

describe("questions", () => {
  const valmy = article({
    cardId: 10,
    title: "Bataille de Valmy",
    views12m: 90_000,
    extract:
      "La bataille de Valmy est une bataille de la Révolution française qui eut lieu le 20 septembre 1792 près de Valmy, dans la Marne. Elle oppose l'armée française aux Prussiens.",
    description: "bataille de la Révolution française",
    thumbUrl: "https://upload.wikimedia.org/valmy.jpg",
  });
  const decoys = [
    article({
      cardId: 11,
      title: "Bataille de Jemappes",
      views12m: 20_000,
      extract: "La bataille de Jemappes a lieu en 1792 en Belgique, entre la France et l'Autriche, dans le Hainaut.",
      description: "bataille de 1792 en Belgique",
      thumbUrl: "https://upload.wikimedia.org/jemappes.jpg",
    }),
    article({
      cardId: 12,
      title: "Bataille de Fleurus (1794)",
      views12m: 15_000,
      description: "victoire française sur les Autrichiens",
      thumbUrl: "https://upload.wikimedia.org/fleurus.jpg",
    }),
    article({
      cardId: 13,
      title: "Bataille de Wattignies",
      views12m: 8_000,
      description: "bataille de la guerre de la Première Coalition",
      thumbUrl: "https://upload.wikimedia.org/wattignies.jpg",
    }),
    article({ cardId: 14, title: "Valmy", views12m: 30_000, description: "commune française de la Marne" }),
  ];

  it("est déterministe (même graine, même question)", () => {
    expect(makeQuestion("s:1", valmy, decoys)).toEqual(makeQuestion("s:1", valmy, decoys));
  });

  it("produit toujours 4 choix distincts avec la bonne réponse", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const q = makeQuestion(`seed-${i}`, valmy, decoys, { maxYear: 2026 });
      seen.add(q.type);
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices).size).toBe(4);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      if (q.type === "definition") expect(q.choices[q.answer]).toBe("Bataille de la Révolution française");
      if (q.type === "year") {
        expect(q.choices[q.answer]).toBe("1792");
        expect(q.prompt).toContain("▢▢▢▢");
        expect(q.prompt).not.toContain("1792");
      }
      if (q.type === "image") expect(q.choices[q.answer]).toBe(valmy.thumbUrl);
      if (q.type === "who_am_i") {
        expect(q.titleHidden).toBe(true);
        expect(q.choices[q.answer]).toBe("Bataille de Valmy");
        // « Valmy » contient le titre de base : jamais proposé comme leurre (ambigu avec l'extrait masqué).
        expect(q.choices).not.toContain("Valmy");
        expect(q.prompt).not.toMatch(/valmy/i);
      } else expect(q.titleHidden).toBe(false);
    }
    expect(seen).toEqual(new Set(["definition", "year", "image", "who_am_i"]));
  });

  it("évite les types déjà posés quand c'est possible", () => {
    for (let i = 0; i < 20; i++) {
      const q = makeQuestion(`a-${i}`, valmy, decoys, { avoid: ["definition", "image", "who_am_i"], maxYear: 2026 });
      expect(q.type).toBe("year");
    }
  });

  it("ne prend les leurres de reconnaissance que parmi les articles connus du joueur (boss)", () => {
    const known = [1, 2, 3, 4].map((n) =>
      article({
        cardId: 40 + n,
        title: `Ma carte ${n}`,
        views12m: n * 1_000,
        extract: `Ma carte ${n} est un article de test assez long pour servir d'extrait dans une question.`,
        description: `article de test numéro ${n}`,
        thumbUrl: `https://upload.wikimedia.org/mienne-${n}.jpg`,
      }),
    );
    const allowedTitles = new Set([valmy.title, ...known.map((k) => k.title)]);
    const allowedThumbs = new Set([valmy.thumbUrl, ...known.map((k) => k.thumbUrl)]);
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const q = makeQuestion(`k-${i}`, valmy, decoys, { maxYear: 2026, known });
      seen.add(q.type);
      if (q.type === "who_am_i" || q.type === "popular") for (const c of q.choices) expect(allowedTitles).toContain(c);
      if (q.type === "image") for (const c of q.choices) expect(allowedThumbs).toContain(c);
    }
    expect(seen).toContain("image");
    expect(seen).toContain("who_am_i");
    // Pas assez d'images parmi les cartes connues : pas de question d'image.
    const noThumbs = known.map((k) => ({ ...k, thumbUrl: null }));
    for (let i = 0; i < 30; i++)
      expect(makeQuestion(`n-${i}`, valmy, decoys, { known: noThumbs }).type).not.toBe("image");
  });

  it("se replie sur « le plus lu » sans résumé ni description", () => {
    const bare = article({ cardId: 20, title: "Zorglub", views12m: 500 });
    const others = [1, 2, 3].map((n) => article({ cardId: 30 + n, title: `Article ${n}`, views12m: n * 1_000 }));
    const q = makeQuestion("x", bare, others);
    expect(q.type).toBe("popular");
    expect(q.choices).toHaveLength(4);
    expect(q.choices[q.answer]).toBe("Article 3");
  });

  it("phrase à trou : années proches, triées, jamais au-delà de l'année en cours", () => {
    for (let i = 0; i < 30; i++) {
      const q = yearQuestion(
        "Le club a été fondé en 2019 à Lyon par un groupe de supporters.",
        seededRandom(`y${i}`),
        2026,
      )!;
      const years = q.choices.map(Number);
      expect(years).toEqual([...years].sort((a, b) => a - b));
      expect(years.every((y) => y <= 2026)).toBe(true);
      expect(q.choices[q.answer]).toBe("2019");
    }
    expect(yearQuestion("Aucune date ici, juste une phrase assez longue.", seededRandom("z"), 2026)).toBeNull();
  });

  it("repère les titres trop proches", () => {
    expect(titlesClash("Valmy", "Bataille de Valmy")).toBe(true);
    expect(titlesClash("Élan", "elan (animal)")).toBe(true);
    expect(titlesClash("Bataille de Jemappes", "Bataille de Valmy")).toBe(false);
  });

  it("masque le titre dans le résumé et le tronque", () => {
    const masked = maskExtract("La tour Eiffel est une tour de fer puddlé à Paris. ".repeat(10), "Tour Eiffel");
    expect(masked).not.toMatch(/eiffel/i);
    expect(masked.length).toBeLessThanOrEqual(261);
  });

  it("« C'est quoi ? » : la bonne réponse n'est pas trahie par sa longueur", () => {
    const target = "chaîne de télévision d'information en continu française";
    const pool = [
      "magazine français",
      "journal gratuit",
      "groupe de musique japonais",
      "chaîne de télévision musicale britannique",
      "chaîne de radio généraliste publique française",
      "chaîne de télévision jeunesse diffusée en Belgique et en Suisse",
      "station de radio locale",
      "quotidien régional français fondé à Toulouse en 1944",
      "chaîne de télévision d'information en continu française",
      "chaîne de télévision privée généraliste française du groupe TF1, lancée en 1987",
      "chaîne de télévision publique française consacrée aux régions et à l'actualité locale",
      "chaîne d'information en continu française",
    ];
    const ranks = [0, 0, 0, 0];
    for (let i = 0; i < 400; i++) {
      const decoys = definitionDecoys(target, pool, seededRandom(`def-${i}`))!;
      expect(decoys).toHaveLength(3);
      expect(decoys).not.toContain(target);
      // Leurres dans une fourchette de longueur : ni « Journal gratuit » face à une phrase entière.
      expect(decoys.every((d) => d.length >= target.length * 0.5 && d.length <= target.length * 2)).toBe(true);
      ranks[decoys.filter((d) => d.length > target.length).length]!++;
    }
    // La bonne réponse est tantôt la plus longue, tantôt la plus courte, tantôt entre les deux.
    expect(ranks.every((n) => n > 40)).toBe(true);
    // Même genre d'abord : au moins une autre « chaîne… » parmi les leurres.
    expect(definitionDecoys(target, pool, seededRandom("x"))!.some((d) => d.startsWith("chaîne"))).toBe(true);
    // Pas assez de leurres de longueur comparable : pas de question « C'est quoi ? ».
    expect(definitionDecoys(target, ["revue", "film", "jeu"], seededRandom("y"))).toBeNull();
  });

  it("genre d'un article : premier mot de la description, sans accent", () => {
    expect(descriptionHead("Chaîne de télévision française")).toBe("chaine");
    expect(descriptionHead("  homme d'État iranien")).toBe("homme");
    expect(descriptionHead(null)).toBeNull();
  });

  it("« Quelle image ? » : jamais de logo SVG ni d'image de remplacement", () => {
    expect(
      unusableQuizImage("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/CNews.svg/320px-CNews.svg.png"),
    ).toBe(true);
    expect(unusableQuizImage("https://upload.wikimedia.org/wikipedia/commons/a/a8/Defaut.svg")).toBe(true);
    expect(unusableQuizImage("https://upload.wikimedia.org/x/Silhouette_homme.png")).toBe(true);
    expect(unusableQuizImage("https://upload.wikimedia.org/x/Reza_Shah_1920.jpg")).toBe(false);
    expect(unusableQuizImage(null)).toBe(true);
    const logo = article({
      cardId: 1,
      title: "CNews",
      thumbUrl: "https://upload.wikimedia.org/CNews.svg/320px-CNews.svg.png",
    });
    const photos = [2, 3, 4].map((n) =>
      article({ cardId: n, title: `Chaîne ${n}`, thumbUrl: `https://upload.wikimedia.org/${n}.jpg` }),
    );
    for (let i = 0; i < 20; i++) expect(makeQuestion(`l-${i}`, logo, photos).type).not.toBe("image");
  });

  it("« Quelle image ? » et « Qui suis-je ? » : la carte attaquante reste cachée jusqu'à la réponse", () => {
    expect(cardHiddenUntilAnswer({ type: "image", titleHidden: false })).toBe(true);
    expect(cardHiddenUntilAnswer({ type: "who_am_i", titleHidden: true })).toBe(true);
    expect(cardHiddenUntilAnswer({ type: "definition", titleHidden: false })).toBe(false);
  });
});
