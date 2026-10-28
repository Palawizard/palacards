import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  applyStatUpdates,
  isNumberTitle,
  isPalindromeTitle,
  isShortTitle,
  newlyUnlocked,
  STAT_KEYS,
  statUpdates,
  type GameEvent,
  type StatKey,
} from "./achievements.js";

/** Statistiques après une suite d'événements. */
function run(events: GameEvent[], start: [StatKey, number][] = []) {
  const stats = new Map<StatKey, number>(start);
  for (const e of events) applyStatUpdates(stats, statUpdates(e));
  return stats;
}
const unlockedKeys = (stats: Map<StatKey, number>, already: string[] = []) =>
  newlyUnlocked(stats, new Set(already))
    .map((a) => a.key)
    .sort();

describe("succès à paliers", () => {
  it("définit plus de cent succès, aux clés uniques, tous récompensés", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(ACHIEVEMENTS.map((a) => a.key)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.reward.pw + a.reward.packs).toBeGreaterThan(0);
      expect(STAT_KEYS).toContain(a.stat);
    }
  });

  it("garde les clés des succès de la V1 (déjà débloqués chez les joueurs)", () => {
    const keys = new Set(ACHIEVEMENTS.map((a) => a.key));
    for (const k of [
      "first_pack",
      "packs_100",
      "packs_1000",
      "first_sr",
      "first_ur",
      "first_l",
      "legend_10",
      "ur_10pct",
      "collection_1000",
      "first_sale",
      "big_sale",
      "first_trade",
      "first_battle",
      "wins_10",
      "wins_100",
      "streak_5",
      "level_5",
      "join_guild",
      "friends_5",
      "login_7",
    ])
      expect(keys.has(k)).toBe(true);
  });

  it("ordonne les paliers d'une famille par objectif croissant et récompense croissante", () => {
    const families = new Map<string, typeof ACHIEVEMENTS>();
    for (const a of ACHIEVEMENTS.filter((x) => !x.secret))
      families.set(a.family, [...(families.get(a.family) ?? []), a]);
    for (const list of families.values()) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!.target).toBeGreaterThan(list[i - 1]!.target);
        expect(list[i]!.stat).toBe(list[0]!.stat);
      }
    }
  });

  it("débloque le premier paquet et la première Légendaire, pas encore Déballeur", () => {
    const stats = run([{ type: "pack_opened", rarities: ["C", "C", "PC", "R", "L"] }]);
    const keys = unlockedKeys(stats);
    expect(keys).toContain("first_pack");
    expect(keys).toContain("first_l");
    expect(keys).not.toContain("packs_10");
    expect(keys).not.toContain("first_sr");
  });

  it("débloque d'un coup tous les paliers atteints, sauf ceux déjà débloqués", () => {
    const stats = run([], [["packs_opened", 600]]);
    expect(unlockedKeys(stats, ["first_pack"])).toEqual(["packs_10", "packs_100", "packs_500"]);
  });

  it("compte les records sans jamais les faire baisser", () => {
    const stats = run([
      { type: "battle_finished", won: true, winStreak: 5, elo: 1_120 },
      { type: "battle_finished", won: false, winStreak: 0, elo: 1_090 },
    ]);
    expect(stats.get("best_win_streak")).toBe(5);
    expect(stats.get("elo_peak")).toBe(1_120);
    expect(stats.get("battles_played")).toBe(2);
    expect(stats.get("battles_won")).toBe(1);
  });

  it("calcule la part des UR de la saison et l'abécédaire", () => {
    const stats = run([
      { type: "collection", uniqueCards: 10, uniqueLegendary: 0, season: { UR: { owned: 1, total: 9 } }, initials: 13 },
    ]);
    expect(stats.get("ur_pct")).toBe(11);
    expect(unlockedKeys(stats)).toEqual(["abc_13", "ur_10pct", "ur_1pct", "ur_2pct", "ur_5pct"]);
  });

  it("calcule la part de la saison des autres raretés en dixièmes de pour cent", () => {
    const stats = run([
      {
        type: "collection",
        uniqueCards: 0,
        uniqueLegendary: 0,
        season: {
          C: { owned: 3_300, total: 1_600_000 },
          PC: { owned: 7_500, total: 750_000 },
          R: { owned: 999, total: 200_000 },
          SR: { owned: 1_200, total: 40_000 },
          L: { owned: 30, total: 1_000 },
          UR: { owned: 5, total: 0 },
        },
      },
    ]);
    expect(Object.fromEntries(stats)).toEqual({ season_c: 2, season_pc: 10, season_r: 4, season_sr: 30, season_l: 30 });
    expect(unlockedKeys(stats)).toEqual(
      [
        "c_0p1pct",
        "c_0p2pct",
        "pc_0p1pct",
        "pc_0p2pct",
        "pc_0p5pct",
        "pc_1pct",
        "sr_0p5pct",
        "sr_1pct",
        "sr_2pct",
        "sr_3pct",
        "l_0p5pct",
        "l_1pct",
        "l_2pct",
        "l_3pct",
      ].sort(),
    );
    expect(ACHIEVEMENTS.find((a) => a.key === "c_0p5pct")?.description).toBe(
      "Posséder 0,5\u00a0% des Communes de la saison, tirées de ses propres paquets.",
    );
  });

  it("plafonne les UR de la saison à 10 % et ne débloque plus l'ancien palier de 25 %", () => {
    const ur = ACHIEVEMENTS.filter((a) => a.stat === "ur_pct" && !a.retired);
    expect(ur.at(-1)).toMatchObject({ key: "ur_10pct", target: 10 });
    expect(ACHIEVEMENTS.find((a) => a.key === "ur_25pct")).toMatchObject({ retired: true, target: 25 });
    const stats = run([], [["ur_pct", 30]]);
    expect(unlockedKeys(stats)).not.toContain("ur_25pct");
    // Un joueur qui a déjà les anciens paliers ne reçoit que le nouveau.
    expect(unlockedKeys(stats, ["ur_1pct", "ur_5pct", "ur_10pct", "ur_25pct"])).toEqual(["ur_2pct"]);
  });

  it("ne fait dépendre de l'état de la collection que des succès « tirés de ses propres paquets »", () => {
    const collectionStats = ["unique_cards", "unique_l", "ur_pct", "initials"];
    for (const a of ACHIEVEMENTS.filter((x) => collectionStats.includes(x.stat) || x.stat.startsWith("season_")))
      expect(a.description).toMatch(/tiré(e)?s de ses propres paquets/);
  });

  it("ne compte que les ventes à plus de 1 000 PW face à deux enchérisseurs pour le coup de marteau", () => {
    expect(run([{ type: "sale", price: 1_000, bidders: 2 }]).get("big_sales")).toBeUndefined();
    expect(run([{ type: "sale", price: 5_000, bidders: 1 }]).get("big_sales")).toBeUndefined();
    expect(run([{ type: "sale", price: 1_001, bidders: 2 }]).get("big_sales")).toBe(1);
  });

  it("débloque le record de vente à 5 000 puis 10 000 PW, sans repayer un palier déjà débloqué", () => {
    expect(unlockedKeys(run([{ type: "sale", price: 9_999, bidders: 1 }]))).not.toContain("best_sale_20000");
    const stats = run([{ type: "sale", price: 10_000, bidders: 1 }]);
    expect(unlockedKeys(stats)).toEqual(expect.arrayContaining(["best_sale_5000", "best_sale_20000"]));
    expect(unlockedKeys(stats, ["best_sale_5000", "best_sale_20000"])).not.toContain("best_sale_20000");
    expect(ACHIEVEMENTS.find((a) => a.key === "best_sale_20000")?.description).toMatch(
      /^Vendre une carte au moins 10\s000 PW\.$/,
    );
  });

  it("repère les succès secrets d'un paquet", () => {
    const stats = run([
      {
        type: "pack_opened",
        rarities: ["C", "PC", "R", "SR", "UR", "L"],
        shinies: [false, false, false, false, false, true],
        titles: ["Laval", "1789", "Pi", "Wikipédia", "Paris", "Rome"],
      },
    ]);
    expect(unlockedKeys(stats)).toEqual(
      expect.arrayContaining([
        "secret_meta",
        "secret_palindrome",
        "secret_number",
        "secret_short",
        "secret_jackpot",
        "secret_rainbow",
        "secret_shiny_l",
        "shiny_1",
      ]),
    );
    expect(isPalindromeTitle("Ésope reste ici et se repose")).toBe(true);
    expect(isPalindromeTitle("Kayak")).toBe(true);
    expect(isPalindromeTitle("Ana")).toBe(false);
    expect(isNumberTitle("1789")).toBe(true);
    expect(isNumberTitle("1789 (film)")).toBe(false);
    expect(isShortTitle("Ré")).toBe(true);
  });

  it("compte les brillantes de l'upgrader, des roues et de la boutique dans « Ça brille ! »", () => {
    const stats = run([
      { type: "pack_opened", rarities: ["C"], shinies: [true] },
      { type: "shiny_obtained", source: "upgrade", count: 2 },
      { type: "shiny_obtained", source: "wheel", count: 1 },
      { type: "shiny_obtained", source: "shop", count: 1 },
    ]);
    expect(stats.get("shiny_pulled")).toBe(5);
    expect(unlockedKeys(stats)).toContain("shiny_5");
    expect(run([{ type: "shiny_obtained", source: "shop", count: 0 }]).get("shiny_pulled")).toBeUndefined();
  });

  it("compte boss, « Plus ou moins vu », quêtes, recyclage et upgrades", () => {
    const stats = run([
      { type: "boss_assault", damage: 320 },
      { type: "boss_phase", phase: 1, lastHit: false },
      { type: "boss_phase", phase: 2, lastHit: true },
      { type: "boss_mvp" },
      { type: "hl_finished", streak: 7 },
      { type: "hl_finished", streak: 0 },
      { type: "hl_finished", streak: 4 },
      { type: "quest_completed", period: "day" },
      { type: "recycled", rarities: ["C", "L"] },
      { type: "upgrade", success: true },
    ]);
    expect(Object.fromEntries(stats)).toMatchObject({
      boss_assaults: 1,
      boss_damage: 320,
      boss_kills: 1,
      boss_phases: 2,
      boss_last_hit: 1,
      boss_mvp: 1,
      hl_best_streak: 7,
      hl_wins: 11,
      quests_daily: 1,
      recycled: 2,
      recycled_l: 1,
      upgrades: 1,
      upgrades_won: 1,
    });
  });

  it("retire les succès de l'article du jour (gardés par leurs détenteurs), ajoute ceux de « Plus ou moins vu »", () => {
    const retired = ACHIEVEMENTS.filter((a) => a.retired).map((a) => a.key);
    for (const key of [
      "article_1",
      "article_7",
      "article_30",
      "article_100",
      "article_first_1",
      "article_first_10",
      "secret_article_fail",
    ])
      expect(retired).toContain(key);
    const streaks = ACHIEVEMENTS.filter((a) => a.stat === "hl_best_streak");
    expect(streaks.map((a) => a.target)).toEqual([5, 10, 15, 20]);
    expect(ACHIEVEMENTS.filter((a) => a.stat === "hl_wins").map((a) => a.target)).toEqual([25, 100, 500, 2_000]);
    // Jamais débloqués à nouveau, même avec la statistique.
    expect(newlyUnlocked(new Map([["articles_found", 500]]), new Set()).some((a) => a.stat === "articles_found")).toBe(
      false,
    );
    expect(newlyUnlocked(new Map([["hl_best_streak", 10]]), new Set()).map((a) => a.key)).toEqual([
      "hl_streak_5",
      "hl_streak_10",
    ]);
  });
});
