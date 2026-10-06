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
      { type: "collection", uniqueCards: 10, uniqueLegendary: 0, uniqueUR: 1, totalUR: 9, initials: 13 },
    ]);
    expect(stats.get("ur_pct")).toBe(11);
    expect(unlockedKeys(stats)).toEqual(["abc_13", "ur_10pct", "ur_1pct", "ur_5pct"]);
  });

  it("ne fait dépendre de l'état de la collection que des succès « tirés de ses propres paquets »", () => {
    for (const a of ACHIEVEMENTS.filter((x) => ["unique_cards", "unique_l", "ur_pct", "initials"].includes(x.stat)))
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

  it("compte boss, article du jour, quêtes, recyclage et upgrades", () => {
    const stats = run([
      { type: "boss_assault", damage: 320 },
      { type: "boss_killed", lastHit: false },
      { type: "boss_mvp" },
      { type: "article_played", found: true, guesses: 1 },
      { type: "article_played", found: false, guesses: 6 },
      { type: "quest_completed", period: "day" },
      { type: "recycled", rarities: ["C", "L"] },
      { type: "upgrade", success: true },
    ]);
    expect(Object.fromEntries(stats)).toMatchObject({
      boss_assaults: 1,
      boss_damage: 320,
      boss_kills: 1,
      boss_mvp: 1,
      articles_found: 1,
      articles_first_try: 1,
      article_failed: 1,
      quests_daily: 1,
      recycled: 2,
      recycled_l: 1,
      upgrades: 1,
      upgrades_won: 1,
    });
  });
});
