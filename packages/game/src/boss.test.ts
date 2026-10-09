import { describe, expect, it } from "vitest";
import type { QuizArticle } from "./battle.js";
import {
  BOSS_CRIT_MS,
  BOSS_DUEL_MULT,
  BOSS_HP_CAP,
  BOSS_LEGACY_HISTORY_FACTOR,
  BOSS_MIN_HP,
  BOSS_PHASE_MIN_DAMAGE,
  BOSS_QUESTION_MS,
  BOSS_REWARDS,
  BOSS_YEAR_QUESTION_MS,
  bossDamage,
  bossDayReward,
  bossDayRule,
  bossHit,
  bossHitBase,
  bossPhase1Hp,
  bossPhaseHp,
  bossPhaseReward,
  bossPhaseState,
  bossQuestionMult,
  bossQuestionVariants,
  bossYearMult,
  categoryMult,
  duelPossible,
  fatigueRestDays,
  fatigueSince,
  makeBossQuestion,
  type BossQuizArticle,
} from "./boss.js";
import { addDays } from "./market.js";

const article = (over: Partial<BossQuizArticle>): BossQuizArticle => ({
  cardId: 1,
  title: "Victor Hugo",
  views12m: 1_000_000,
  extract: null,
  description: null,
  thumbUrl: null,
  rarity: "L",
  year: null,
  yearKind: null,
  ...over,
});

const decoy = (i: number, over: Partial<QuizArticle> = {}): QuizArticle => ({
  cardId: 100 + i,
  title: `Leurre ${i}`,
  views12m: 1_000 * (i + 1),
  extract: null,
  description: null,
  thumbUrl: null,
  ...over,
});

describe("boss : phases", () => {
  it("cale la phase 1 sur 35 % des dégâts quotidiens moyens, au minimum 3 000 PV", () => {
    expect(bossPhase1Hp([])).toBe(BOSS_MIN_HP);
    expect(bossPhase1Hp([{ damage: 0, legacy: false }])).toBe(BOSS_MIN_HP);
    // 12 000 par jour : 4 200 PV.
    expect(bossPhase1Hp([{ damage: 12_000, legacy: false }])).toBe(4_250);
    expect(bossPhase1Hp(Array.from({ length: 7 }, () => ({ damage: 20_000, legacy: false })))).toBe(7_000);
    expect(bossPhase1Hp([{ damage: 1e12, legacy: false }])).toBe(BOSS_HP_CAP);
  });

  it("compte les jours de l'ancien format à 60 %", () => {
    expect(bossPhase1Hp([{ damage: 20_000, legacy: true }])).toBe(
      Math.ceil((20_000 * BOSS_LEGACY_HISTORY_FACTOR * 0.35) / 250) * 250,
    );
    // Moitié ancien format, moitié nouveau : la moyenne pondérée.
    expect(
      bossPhase1Hp([
        { damage: 20_000, legacy: true },
        { damage: 10_000, legacy: false },
      ]),
    ).toBe(Math.ceil((((12_000 + 10_000) / 2) * 0.35) / 250) * 250);
  });

  it("donne 40 % de PV de plus à chaque phase", () => {
    expect(bossPhaseHp(4_000, 1)).toBe(4_000);
    expect(bossPhaseHp(4_000, 2)).toBe(5_600);
    expect(bossPhaseHp(4_000, 3)).toBe(7_850);
  });

  it("enchaîne les phases d'après les dégâts du jour, le surplus passant à la suivante", () => {
    expect(bossPhaseState(4_000, 0)).toEqual({ phase: 1, maxHp: 4_000, hp: 4_000, fallen: 0 });
    expect(bossPhaseState(4_000, 3_999)).toEqual({ phase: 1, maxHp: 4_000, hp: 1, fallen: 0 });
    expect(bossPhaseState(4_000, 4_000)).toEqual({ phase: 2, maxHp: 5_600, hp: 5_600, fallen: 1 });
    expect(bossPhaseState(4_000, 4_100)).toEqual({ phase: 2, maxHp: 5_600, hp: 5_500, fallen: 1 });
    expect(bossPhaseState(4_000, 9_600)).toMatchObject({ phase: 3, hp: 7_850, fallen: 2 });
  });

  it("fait tomber la phase 1 un jour moyen, la 2 un bon jour, la 3 un très bon jour", () => {
    const avg = 12_000;
    const p1 = bossPhase1Hp(Array.from({ length: 7 }, () => ({ damage: avg, legacy: false })));
    expect(bossPhaseState(p1, avg * 0.6).fallen).toBe(1);
    expect(bossPhaseState(p1, avg).fallen).toBe(2);
    expect(bossPhaseState(p1, avg * 1.2).fallen).toBe(2);
    expect(bossPhaseState(p1, avg * 1.6).fallen).toBe(3);
  });
});

describe("boss : règle du jour", () => {
  it("tire une faiblesse et une résistance différentes, jamais celles de la veille", () => {
    let prev = null;
    for (let i = 0; i < 200; i++) {
      const day = addDays("2026-10-01", i);
      const rule = bossDayRule(day, prev);
      expect(rule.weakness).not.toBe(rule.resistance);
      if (prev) {
        expect(rule.weakness).not.toBe(prev.weakness);
        expect(rule.resistance).not.toBe(prev.resistance);
      }
      expect(bossDayRule(day, prev)).toEqual(rule);
      prev = rule;
    }
  });

  it("double les dégâts de la faiblesse et divise par deux ceux de la résistance", () => {
    const rule = { weakness: "lieu", resistance: "personne" } as const;
    expect(categoryMult("lieu", rule)).toBe(2);
    expect(categoryMult("personne", rule)).toBe(0.5);
    expect(categoryMult("oeuvre", rule)).toBe(1);
  });
});

describe("boss : cartes fatiguées", () => {
  it("rend un article jouable trois jours après", () => {
    expect(fatigueRestDays("2026-10-09", "2026-10-09")).toBe(3);
    expect(fatigueRestDays("2026-10-09", "2026-10-10")).toBe(2);
    expect(fatigueRestDays("2026-10-09", "2026-10-11")).toBe(1);
    expect(fatigueRestDays("2026-10-09", "2026-10-12")).toBe(0);
    expect(fatigueRestDays("2026-10-31", "2026-11-02")).toBe(1);
    expect(fatigueSince("2026-10-12")).toBe("2026-10-10");
  });
});

describe("boss : dégâts", () => {
  it("frappe selon l'ATK, en critique sous 4 s, rien sur une erreur", () => {
    expect(bossHitBase(2_500)).toBe(65);
    const hit = bossHit({ kind: "choice", correct: true, answerMs: 6_000 });
    const crit = bossHit({ kind: "choice", correct: true, answerMs: BOSS_CRIT_MS });
    expect(hit).toBe("hit");
    expect(crit).toBe("crit");
    expect(bossDamage(2_500, bossQuestionMult("definition", hit))).toBe(65);
    expect(bossDamage(2_500, bossQuestionMult("definition", crit))).toBe(98);
    expect(bossHit({ kind: "choice", correct: false, answerMs: 1_000 })).toBe("miss");
    expect(bossHit({ kind: "choice", correct: true, answerMs: null })).toBe("miss");
    expect(bossDamage(9_999, bossQuestionMult("definition", "miss"))).toBe(0);
  });

  it("applique faiblesse et résistance", () => {
    expect(bossDamage(2_500, 1, 2)).toBe(130);
    expect(bossDamage(2_500, 1.5, 0.5)).toBe(49);
  });

  it("paie l'année tapée selon l'écart, exacte en critique", () => {
    expect(bossYearMult(1889, 1889)).toBe(1.5);
    expect(bossYearMult(1891, 1889)).toBe(1);
    expect(bossYearMult(1879, 1889)).toBe(0.5);
    expect(bossYearMult(1914, 1889)).toBe(0.25);
    expect(bossYearMult(1915, 1889)).toBe(0);
    expect(bossYearMult(null, 1889)).toBe(0);
    expect(bossHit({ kind: "year", guess: 1889, answer: 1889 })).toBe("crit");
    expect(bossHit({ kind: "year", guess: 1900, answer: 1889 })).toBe("hit");
    expect(bossHit({ kind: "year", guess: 2000, answer: 1889 })).toBe("miss");
    const y = { guess: 1880, answer: 1889 };
    expect(bossDamage(2_500, bossQuestionMult("year_input", "hit", y))).toBe(33);
  });

  it("réduit les duels et ne les compte jamais en critique", () => {
    const h = bossHit({ kind: "duel", correct: true, answerMs: 500 });
    expect(h).toBe("hit");
    expect(bossQuestionMult("duel_older", h)).toBe(BOSS_DUEL_MULT);
    expect(bossDamage(2_500, bossQuestionMult("duel_popular", h))).toBe(49);
  });
});

describe("boss : récompenses", () => {
  it("paie chaque phase tombée au-delà du seuil personnel", () => {
    expect(bossPhaseReward(1)).toEqual({ pw: 50, packs: 1 });
    expect(bossPhaseReward(2)).toEqual({ pw: 50, packs: 1 });
    expect(bossPhaseReward(3)).toEqual({ pw: 75, packs: 0 });
    expect(bossPhaseReward(7)).toEqual({ pw: 75, packs: 0 });
    expect(bossDayReward({ fallen: 3, damage: BOSS_PHASE_MIN_DAMAGE, paidPhases: 0 })).toEqual({
      phases: [1, 2, 3],
      pw: 175,
      packs: 2,
      consolation: false,
    });
    // Deux phases : l'équivalent de l'ancienne chute (100 PW, 2 paquets).
    expect(bossDayReward({ fallen: 2, damage: 900, paidPhases: 0 })).toMatchObject({ pw: 100, packs: 2 });
  });

  it("console ceux qui ont touché le boss sans récompense de phase", () => {
    expect(bossDayReward({ fallen: 0, damage: 900, paidPhases: 0 })).toEqual({
      phases: [],
      pw: BOSS_REWARDS.consolationPw,
      packs: 0,
      consolation: true,
    });
    expect(bossDayReward({ fallen: 2, damage: BOSS_PHASE_MIN_DAMAGE - 1, paidPhases: 0 }).consolation).toBe(true);
    expect(bossDayReward({ fallen: 0, damage: 0, paidPhases: 0 }).pw).toBe(0);
  });

  it("ne repaie pas les phases déjà payées (ancienne chute : phases 1 et 2)", () => {
    expect(bossDayReward({ fallen: 2, damage: 900, paidPhases: 2 })).toMatchObject({ phases: [], pw: 0 });
    expect(bossDayReward({ fallen: 3, damage: 900, paidPhases: 2 })).toMatchObject({ phases: [3], pw: 75, packs: 0 });
    expect(bossDayReward({ fallen: 1, damage: 50, paidPhases: 2 })).toMatchObject({ pw: 0, consolation: false });
  });
});

describe("boss : questions", () => {
  const boss = article({ cardId: 9, title: "Napoléon Ier", views12m: 3_000_000, year: 1769, yearKind: "birth" });
  const extract =
    "La tour Eiffel est une tour de fer puddlé de 330 mètres de hauteur située à Paris. Elle est inaugurée en 1889 pour l'Exposition universelle.";
  const target = article({
    cardId: 2,
    title: "Tour Eiffel",
    description: "tour en fer puddlé de Paris",
    extract,
    thumbUrl: "https://upload.wikimedia.org/tour.jpg",
    year: 1887,
    yearKind: "inception",
    views12m: 1_000_000,
  });
  const decoys = Array.from({ length: 8 }, (_, i) =>
    decoy(i, {
      description: [
        "tour de télévision",
        "tour de guet en pierre",
        "gratte-ciel à New York",
        "tour médiévale d'Italie",
        "phare breton en granit",
        "tour de radio allemande",
        "donjon du château de Vincennes",
        "minaret de la grande mosquée",
      ][i],
      thumbUrl: `https://upload.wikimedia.org/d${i}.jpg`,
    }),
  );

  it("propose définition, image, années tapées et duels", () => {
    const v = bossQuestionVariants("s", target, decoys, { boss, maxYear: 2026 });
    expect(v.map((x) => `${x.type}:${x.key}`).sort()).toEqual(
      [
        "definition:definition",
        "duel_older:older",
        "duel_popular:popular",
        "image:image",
        "year_input:extract:1889",
        "year_input:wikidata",
      ].sort(),
    );
  });

  it("ne pose un duel que si les valeurs diffèrent nettement (et « plus lu » à rareté égale)", () => {
    expect(duelPossible("duel_older", { ...target, year: 1900 }, { ...boss, year: 1891 })).toBe(false);
    expect(duelPossible("duel_older", { ...target, year: 1900 }, { ...boss, year: 1890 })).toBe(true);
    expect(duelPossible("duel_older", { ...target, year: null }, boss)).toBe(false);
    expect(duelPossible("duel_popular", { ...target, views12m: 2_100_000 }, boss)).toBe(false);
    expect(duelPossible("duel_popular", { ...target, views12m: 2_000_000 }, boss)).toBe(true);
    expect(duelPossible("duel_popular", { ...target, rarity: "UR" }, boss)).toBe(false);
  });

  it("prend les leurres de l'image hors de la sélection, carte cachée", () => {
    const q = makeBossQuestion("img", target, decoys, {
      boss,
      history: [
        { type: "definition", key: "definition", askedAt: 1 },
        { type: "year_input", key: "extract:1889", askedAt: 1 },
        { type: "year_input", key: "wikidata", askedAt: 1 },
        { type: "duel_older", key: "older", askedAt: 1 },
        { type: "duel_popular", key: "popular", askedAt: 1 },
      ],
      maxYear: 2026,
    });
    expect(q.type).toBe("image");
    expect(q.cardHidden).toBe(true);
    expect(q.choices).toHaveLength(4);
    expect(q.choices[q.answer]).toBe(target.thumbUrl);
    expect(q.choices.filter((c) => c.startsWith("https://upload.wikimedia.org/d"))).toHaveLength(3);
  });

  it("pose l'année à taper avec un chrono plus long, l'année en réponse", () => {
    const q = makeBossQuestion("y", target, [], {
      boss: null,
      history: [{ type: "definition", key: "definition", askedAt: 1 }],
      avoid: [],
      maxYear: 2026,
    });
    expect(q.type).toBe("year_input");
    expect(q.durationMs).toBe(BOSS_YEAR_QUESTION_MS);
    expect(q.choices).toEqual([]);
    expect([1887, 1889]).toContain(q.answer);
    if (q.key === "extract:1889") expect(q.prompt).toContain("▢▢▢▢");
    else expect(q.prompt).toBe("En quelle année a été créé ou fondé « Tour Eiffel » ?");
  });

  it("met la carte contre le boss dans un duel à deux choix", () => {
    const q = makeBossQuestion("d", { ...target, extract: null, description: null, thumbUrl: null, year: 1887 }, [], {
      boss,
      history: [{ type: "duel_popular", key: "popular", askedAt: 1 }],
    });
    expect(q.type).toBe("duel_older");
    expect(q.choices.sort()).toEqual(["Napoléon Ier", "Tour Eiffel"]);
    expect(q.choices[q.answer]).toBe("Napoléon Ier");
    expect(q.durationMs).toBe(BOSS_QUESTION_MS);
  });

  it("ne repose jamais une variante déjà vue tant qu'il en reste, puis la plus ancienne", () => {
    const seen: { type: string; key: string; askedAt: number }[] = [];
    const all = bossQuestionVariants("s", target, decoys, { boss, maxYear: 2026 }).length;
    for (let i = 0; i < all; i++) {
      const q = makeBossQuestion(`seed-${i}`, target, decoys, { boss, history: seen, maxYear: 2026 });
      expect(seen.some((h) => h.type === q.type && h.key === q.key)).toBe(false);
      seen.push({ type: q.type, key: q.key, askedAt: 1_000 + i });
    }
    const again = makeBossQuestion("seed-x", target, decoys, { boss, history: seen, maxYear: 2026 });
    expect(`${again.type}:${again.key}`).toBe(`${seen[0]!.type}:${seen[0]!.key}`);
  });

  it("change les leurres selon la graine (joueur et jour)", () => {
    const history = [
      { type: "year_input", key: "extract:1889", askedAt: 1 },
      { type: "year_input", key: "wikidata", askedAt: 1 },
      { type: "duel_older", key: "older", askedAt: 1 },
      { type: "duel_popular", key: "popular", askedAt: 1 },
      { type: "image", key: "image", askedAt: 1 },
    ];
    const sets = new Set(
      Array.from({ length: 8 }, (_, i) =>
        makeBossQuestion(`boss:2026-10-0${i}:u1`, target, decoys, { boss, history, maxYear: 2026 })
          .choices.slice()
          .sort()
          .join("|"),
      ),
    );
    expect(sets.size).toBeGreaterThan(1);
  });

  it("se replie sur « le plus lu » sans résumé", () => {
    const q = makeBossQuestion("p", article({ cardId: 3, title: "Inconnu", rarity: "SR", views12m: 500 }), decoys, {
      boss,
    });
    expect(q.type).toBe("popular");
    expect(q.choices).toHaveLength(4);
  });
});
