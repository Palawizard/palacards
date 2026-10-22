import { describe, expect, it } from "vitest";
import type { GameEvent } from "./achievements.js";
import { autoRecyclePicks, isBetterCopy } from "./collection.js";
import { weirdGenresOfTitle } from "./feed.js";
import { PASS_MAX_LEVEL, PASS_OVERFLOW_PW, passProgress, passReward, xpForEvent, xpToReach } from "./pass.js";
import {
  dailyQuests,
  QUEST_POOL,
  QUEST_RECORD_KINDS,
  questLabel,
  questProgress,
  rerollQuest,
  weeklyQuest,
} from "./quests.js";
import { recycleValue, rollShiny, SHINY_CHANCE } from "./shiny.js";

describe("passe de saison", () => {
  it("compte 200 niveaux, 40 100 XP pour le recto et 500 XP par niveau ensuite", () => {
    expect(PASS_MAX_LEVEL).toBe(200);
    expect(xpToReach(100)).toBe(40_100);
    expect(xpToReach(PASS_MAX_LEVEL)).toBe(90_100);
    expect(passProgress(0)).toEqual({ level: 0, into: 0, need: 302 });
    expect(passProgress(302)).toEqual({ level: 1, into: 0, need: 304 });
    expect(passProgress(xpToReach(37) + 10).level).toBe(37);
    expect(passProgress(xpToReach(99))).toEqual({ level: 99, into: 0, need: 500 });
    expect(passProgress(40_100)).toEqual({ level: 100, into: 0, need: 500 });
    expect(passProgress(xpToReach(150) + 499)).toEqual({ level: 150, into: 499, need: 500 });
    for (const level of [1, 37, 99, 100, 101, 200, 250]) expect(passProgress(xpToReach(level)).level).toBe(level);
  });

  it("continue de compter les niveaux après 200", () => {
    expect(passProgress(xpToReach(200) + 1_250)).toEqual({ level: 202, into: 250, need: 500 });
    expect(passProgress(10_000_000).level).toBe(100 + Math.floor((10_000_000 - 40_100) / 500));
    expect(passReward(201)).toEqual({ pw: PASS_OVERFLOW_PW, packs: 0 });
    expect(passReward(1_000)).toEqual({ pw: PASS_OVERFLOW_PW, packs: 0 });
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
    expect(packs).toBe(184);
    expect(pw).toBe(12_700);
    expect(passReward(1)).toEqual({ pw: 0, packs: 1 });
    expect(passReward(2)).toEqual({ pw: 51, packs: 0 });
    expect(passReward(10)).toEqual({ pw: 150, packs: 3 });
    expect(passReward(100)).toEqual({ pw: 1_000, packs: 5 });
    expect(passReward(102)).toEqual({ pw: 101, packs: 0 });
    expect(passReward(110)).toEqual({ pw: 150, packs: 3 });
    expect(passReward(200)).toEqual({ pw: 1_000, packs: 5 });
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
    expect(questProgress("hl_play", { type: "hl_finished", streak: 0 })).toBe(1);
    expect(questProgress("hl_streak", { type: "hl_finished", streak: 6 })).toBe(6);
    expect(questProgress("hl_wins", { type: "hl_finished", streak: 4 })).toBe(4);
    // Anciennes quêtes de l'article du jour déjà tirées : avancées par « Plus ou moins vu ».
    expect(questProgress("play_article", { type: "hl_finished", streak: 0 })).toBe(1);
    expect(questProgress("find_article_fast", { type: "hl_finished", streak: 4 })).toBe(0);
    expect(questProgress("find_article_fast", { type: "hl_finished", streak: 5 })).toBe(1);
    expect(questLabel({ kind: "hl_play", target: 3 })).toBe("Jouer tes 3 essais de « Plus ou moins vu »");
    expect(questLabel({ kind: "hl_streak", target: 5 })).toBe("Faire une série de 5 à « Plus ou moins vu »");
    expect(questLabel({ kind: "hl_wins", target: 15 })).toBe("Cumuler 15 réussites à « Plus ou moins vu »");
    expect(QUEST_RECORD_KINDS).toContain("hl_streak");
    for (const tier of Object.values(QUEST_POOL))
      expect(tier.some((q) => ["play_article", "find_article", "find_article_fast"].includes(q.kind))).toBe(false);
    expect(questProgress("daily_quests", { type: "quest_completed", period: "week" })).toBe(0);
    expect(questLabel({ kind: "open_packs", target: 5 })).toBe("Ouvrir 5 paquets");
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
      ).picks,
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
