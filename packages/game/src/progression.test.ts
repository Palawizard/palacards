import { describe, expect, it } from "vitest";
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
    expect(questProgress("find_article_fast", { type: "article_played", found: true, guesses: 5 })).toBe(0);
    expect(questProgress("find_article_fast", { type: "article_played", found: true, guesses: 4 })).toBe(1);
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
