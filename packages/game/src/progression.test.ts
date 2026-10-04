import { describe, expect, it } from "vitest";
import {
  ARTICLE_MAX_GUESSES,
  articleReward,
  buildClues,
  editDistance,
  isCorrectGuess,
  shareLine,
  titlePattern,
} from "./article.js";
import { bossDamage, bossHit, bossHitBase, bossMaxHp, BOSS_HP_CAP, BOSS_MIN_HP } from "./boss.js";
import type { GameEvent } from "./achievements.js";
import { autoRecyclePicks, isBetterCopy } from "./collection.js";
import { weirdGenresOfTitle } from "./feed.js";
import { PASS_MAX_LEVEL, passProgress, passReward, xpForEvent, xpToReach } from "./pass.js";
import { dailyQuests, QUEST_POOL, questLabel, questProgress, rerollQuest, weeklyQuest } from "./quests.js";
import { recycleValue, rollShiny, SHINY_CHANCE } from "./shiny.js";

describe("passe de saison", () => {
  it("compte 100 niveaux, environ 40 000 XP au total", () => {
    expect(xpToReach(PASS_MAX_LEVEL)).toBe(40_100);
    expect(passProgress(0)).toEqual({ level: 0, into: 0, need: 302 });
    expect(passProgress(302)).toEqual({ level: 1, into: 0, need: 304 });
    expect(passProgress(xpToReach(37) + 10).level).toBe(37);
    expect(passProgress(10_000_000)).toEqual({ level: 100, into: 0, need: 0 });
  });

  it("alterne paquets et PW, gros paliers tous les 10 niveaux", () => {
    let packs = 0;
    let pw = 0;
    for (let n = 1; n <= PASS_MAX_LEVEL; n++) {
      const r = passReward(n);
      expect(r.pw + r.packs).toBeGreaterThan(0);
      packs += r.packs;
      pw += r.pw;
    }
    expect(packs).toBe(92);
    expect(pw).toBe(5_350);
    expect(passReward(1)).toEqual({ pw: 0, packs: 1 });
    expect(passReward(2)).toEqual({ pw: 51, packs: 0 });
    expect(passReward(10)).toEqual({ pw: 150, packs: 3 });
    expect(passReward(100)).toEqual({ pw: 1_000, packs: 5 });
  });

  it("donne de l'XP pour chaque paquet ouvert, plus pour un booster à thème", () => {
    expect(xpForEvent({ type: "pack_opened", rarities: ["C"] })).toBe(10);
    expect(xpForEvent({ type: "pack_opened", rarities: ["C"], themed: true })).toBe(25);
    expect(xpForEvent({ type: "friends", count: 3 })).toBe(0);
  });
});

describe("quêtes", () => {
  it("tire trois quêtes de types différents, toujours les mêmes pour un joueur et un jour", () => {
    const a = dailyQuests("joueur1", "2026-10-02");
    expect(a.map((q) => q.tier)).toEqual(["easy", "medium", "hard"]);
    expect(new Set(a.map((q) => q.kind)).size).toBe(3);
    expect(dailyQuests("joueur1", "2026-10-02")).toEqual(a);
    // Sur un mois, les quêtes changent d'un jour à l'autre.
    const kinds = new Set(
      Array.from(
        { length: 30 },
        (_, i) => dailyQuests("joueur1", `2026-10-${String(i + 1).padStart(2, "0")}`)[0]!.kind,
      ),
    );
    expect(kinds.size).toBeGreaterThan(1);
  });

  it("remplace une quête par un autre type du même créneau", () => {
    const quests = dailyQuests("joueur2", "2026-10-02");
    const next = rerollQuest(
      "joueur2",
      "2026-10-02",
      "easy",
      quests.map((q) => q.kind),
    )!;
    expect(QUEST_POOL.easy.some((q) => q.kind === next.kind)).toBe(true);
    expect(quests.map((q) => q.kind)).not.toContain(next.kind);
  });

  it("donne la même quête de la semaine à tout le monde, du lundi au dimanche", () => {
    expect(weeklyQuest("2026-09-28")).toEqual(weeklyQuest("2026-10-04"));
    expect(weeklyQuest("2026-09-28").week).toBe("2026-09-28");
    expect(weeklyQuest("2026-10-05").week).toBe("2026-10-05");
  });

  it("avance selon les événements", () => {
    const pack: GameEvent = { type: "pack_opened", rarities: ["C", "SR", "UR", "L"] };
    expect(questProgress("open_packs", pack)).toBe(1);
    expect(questProgress("pull_sr", pack)).toBe(3);
    expect(questProgress("pull_ur", pack)).toBe(2);
    expect(questProgress("boss_damage", { type: "boss_assault", damage: 250 })).toBe(250);
    expect(questProgress("find_article_fast", { type: "article_played", found: true, guesses: 4 })).toBe(0);
    expect(questProgress("find_article_fast", { type: "article_played", found: true, guesses: 3 })).toBe(1);
    expect(questProgress("daily_quests", { type: "quest_completed", period: "week" })).toBe(0);
    expect(questLabel({ kind: "open_packs", target: 5 })).toBe("Ouvrir 5 paquets");
  });
});

describe("article du jour", () => {
  it("paie 100 PW au premier essai, 50 au sixième", () => {
    expect(articleReward(1)).toBe(100);
    expect(articleReward(ARTICLE_MAX_GUESSES)).toBe(50);
    expect(articleReward(7)).toBe(0);
  });

  it("accepte le titre sans accents, déterminant, parenthèse ni petite faute", () => {
    expect(isCorrectGuess("la joconde", "La Joconde")).toBe(true);
    expect(isCorrectGuess("Joconde", "La Joconde")).toBe(true);
    expect(isCorrectGuess("mercure", "Mercure (planète)")).toBe(true);
    expect(isCorrectGuess("Etats-Unis", "États-Unis")).toBe(true);
    expect(isCorrectGuess("Napolon Bonaparte", "Napoléon Bonaparte")).toBe(true);
    expect(isCorrectGuess("Pari", "Paris")).toBe(false);
    expect(isCorrectGuess("Lyon", "Paris")).toBe(false);
    expect(isCorrectGuess("", "Paris")).toBe(false);
    expect(editDistance("chat", "chats")).toBe(1);
  });

  it("donne toujours six indices, les lettres en dernier", () => {
    const full = buildClues({
      title: "Tour Eiffel",
      rarity: "L",
      atk: 9_000,
      def: 4_000,
      description: "tour en fer puddlé de Paris",
      extract:
        "La tour Eiffel est une tour de fer puddlé de 330 mètres de hauteur située à Paris. Construite en deux ans par Gustave Eiffel, elle est inaugurée en 1889.",
      thumbUrl: "https://upload.wikimedia.org/tour.jpg",
    });
    expect(full).toHaveLength(6);
    expect(full.map((c) => c.kind)).toEqual(["description", "extract", "image", "more", "letters", "half"]);
    expect(full[1]!.text).not.toMatch(/Eiffel/i);
    const bare = buildClues({
      title: "Paris",
      rarity: "UR",
      atk: 5_000,
      def: 3_000,
      description: null,
      extract: null,
      thumbUrl: null,
    });
    expect(bare.map((c) => c.kind)).toEqual(["rarity", "stats", "size", "letters", "half"]);
    expect(bare[2]!.text).toBe("1 mot, 5 lettres");
    expect(titlePattern("Tour Eiffel", "first")).toBe("T _ _ _   _ _ _ _ _ _");
    expect(shareLine(3, true)).toBe("🟥🟥🟩⬜⬜⬜");
  });
});

describe("boss du jour", () => {
  it("frappe selon l'ATK, en critique sous 4 s, rien sur une erreur", () => {
    expect(bossHitBase(2_500)).toBe(65);
    expect(bossDamage(2_500, bossHit(true, 6_000))).toBe(65);
    expect(bossDamage(2_500, bossHit(true, 3_000))).toBe(98);
    expect(bossDamage(9_999, bossHit(false, 1_000))).toBe(0);
    expect(bossHit(true, null)).toBe("miss");
  });

  it("peut tomber avec dix joueurs moyens (2 assauts de 5 questions)", () => {
    // 65 % de bonnes réponses dont un quart de critiques, cartes à 2 500 ATK.
    const perQuestion = 0.4 * 65 + 0.25 * 98;
    expect(10 * 2 * 5 * perQuestion).toBeGreaterThan(bossMaxHp(10));
  });

  it("a des PV à la mesure des assaillants habituels, sans tomber en un rush de minuit", () => {
    const perPlayerPerDay = 2 * 5 * (0.4 * 65 + 0.25 * 98);
    expect(bossMaxHp(0)).toBe(BOSS_MIN_HP);
    expect(bossMaxHp(Number.NaN)).toBe(BOSS_MIN_HP);
    expect(bossMaxHp(8)).toBe(BOSS_MIN_HP);
    expect(bossMaxHp(20)).toBe(9_000);
    expect(bossMaxHp(20.4)).toBe(9_250);
    expect(bossMaxHp(1e9)).toBe(BOSS_HP_CAP);
    // Vingt habitués : la moitié d'entre eux (le rush de minuit) ne suffit pas, presque tous oui.
    expect(10 * perPlayerPerDay).toBeLessThan(bossMaxHp(20));
    expect(19 * perPlayerPerDay).toBeGreaterThan(bossMaxHp(20));
  });
});

describe("brillantes", () => {
  it("sortent une fois sur mille et se recyclent dix fois mieux", () => {
    expect(rollShiny(() => SHINY_CHANCE - 1)).toBe(true);
    expect(rollShiny(() => SHINY_CHANCE)).toBe(false);
    expect(recycleValue("R")).toBe(10);
    expect(recycleValue("R", true)).toBe(100);
  });

  it("sont gardées en priorité et jamais recyclées automatiquement", () => {
    const base = { id: 1, rarity: "R" as const, level: 1, atk: 100, def: 100 };
    expect(isBetterCopy({ ...base, id: 2, shiny: true }, { ...base, level: 3 })).toBe(true);
    expect(
      autoRecyclePicks(
        [
          { cardId: 1, rarity: "C", shiny: true },
          { cardId: 2, rarity: "C" },
        ],
        "R",
        false,
        new Set(),
      ),
    ).toEqual([1]);
  });
});

describe("fil d'activité", () => {
  it("range les titres bizarres par genre", () => {
    expect(weirdGenresOfTitle("Bataille de Stalingrad")).toContain("ww2");
    expect(weirdGenresOfTitle("Monstre du Loch Ness")).toContain("paranormal");
    expect(weirdGenresOfTitle("Éducation sexuelle")).toContain("sexe");
    expect(weirdGenresOfTitle("Paris")).toEqual([]);
  });
});
