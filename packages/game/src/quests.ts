import type { GameEvent } from "./achievements.js";
import { ARTICLE_FAST_GUESSES } from "./article.js";
import { seededRandom } from "./battle.js";
import { weekStart } from "./guild.js";
import { RARITIES, type Rarity } from "./rarity.js";

// ---------------------------------------------------------------------------
// Quêtes du jour et de la semaine
//
// Chaque jour (heure de Paris), trois quêtes par joueur : une facile, une moyenne, une difficile,
// tirées d'après le joueur et le jour (toujours les mêmes pour lui ce jour-là). Une quête par semaine,
// la même pour tout le monde, beaucoup mieux payée. Une quête du jour peut être changée une fois par jour.
// Les PW sont un peu en dessous de la cible (≈ 200 PW / jour, 2 000 / semaine) : les quêtes donnent aussi
// de l'XP de passe de saison.
// ---------------------------------------------------------------------------

export type QuestKind =
  | "open_packs"
  | "pull_sr"
  | "pull_ur"
  | "recycle_cards"
  | "spin_wheel"
  | "play_article"
  | "find_article"
  | "find_article_fast"
  | "boss_assault"
  | "boss_damage"
  | "win_battle"
  | "upgrade"
  | "daily_quests";

export type QuestTier = "easy" | "medium" | "hard" | "weekly";

export interface QuestDef {
  kind: QuestKind;
  target: number;
}

export const QUEST_REWARDS: Record<QuestTier, { pw: number; xp: number }> = {
  easy: { pw: 40, xp: 150 },
  medium: { pw: 50, xp: 200 },
  hard: { pw: 60, xp: 250 },
  weekly: { pw: 1_500, xp: 1_500 },
};

/** Les trois créneaux du jour, dans l'ordre d'affichage. */
export const DAILY_TIERS = ["easy", "medium", "hard"] as const satisfies readonly QuestTier[];

export const QUEST_POOL: Record<QuestTier, QuestDef[]> = {
  easy: [
    { kind: "open_packs", target: 5 },
    { kind: "spin_wheel", target: 1 },
    { kind: "play_article", target: 1 },
    { kind: "boss_assault", target: 1 },
    { kind: "recycle_cards", target: 10 },
  ],
  medium: [
    { kind: "open_packs", target: 15 },
    { kind: "pull_sr", target: 2 },
    { kind: "find_article", target: 1 },
    { kind: "boss_damage", target: 200 },
    { kind: "upgrade", target: 1 },
    { kind: "recycle_cards", target: 40 },
  ],
  hard: [
    { kind: "open_packs", target: 30 },
    { kind: "pull_sr", target: 5 },
    { kind: "pull_ur", target: 1 },
    { kind: "find_article_fast", target: 1 },
    { kind: "boss_damage", target: 500 },
    { kind: "win_battle", target: 1 },
  ],
  weekly: [
    { kind: "daily_quests", target: 15 },
    { kind: "open_packs", target: 150 },
    { kind: "find_article", target: 5 },
    { kind: "boss_damage", target: 2_500 },
    { kind: "pull_ur", target: 3 },
  ],
};

/** Intitulé d'une quête. */
export function questLabel(q: QuestDef): string {
  const n = q.target.toLocaleString("fr-FR");
  const s = q.target > 1 ? "s" : "";
  switch (q.kind) {
    case "open_packs":
      return `Ouvrir ${n} paquet${s}`;
    case "pull_sr":
      return `Tirer ${n} carte${s} Super rare ou mieux`;
    case "pull_ur":
      return q.target > 1 ? `Tirer ${n} Ultra rares ou mieux` : "Tirer une Ultra rare ou mieux";
    case "recycle_cards":
      return `Recycler ${n} carte${s}`;
    case "spin_wheel":
      return "Tourner une roue du jour";
    case "play_article":
      return "Jouer à l'article du jour";
    case "find_article":
      return q.target > 1 ? `Trouver ${n} articles du jour` : "Trouver l'article du jour";
    case "find_article_fast":
      return `Trouver l'article du jour en ${ARTICLE_FAST_GUESSES} essais ou moins`;
    case "boss_assault":
      return q.target > 1 ? `Lancer ${n} assauts contre le boss` : "Lancer un assaut contre le boss";
    case "boss_damage":
      return `Infliger ${n} dégâts au boss`;
    case "win_battle":
      return q.target > 1 ? `Gagner ${n} duels` : "Gagner un duel";
    case "upgrade":
      return q.target > 1 ? `Tenter ${n} upgrades` : "Tenter un upgrade";
    case "daily_quests":
      return `Terminer ${n} quêtes du jour`;
  }
}

/** Page du jeu où avancer une quête. */
export const QUEST_HREF: Record<QuestKind, string> = {
  open_packs: "/pulls",
  pull_sr: "/pulls",
  pull_ur: "/pulls",
  recycle_cards: "/collection",
  spin_wheel: "/wheel",
  play_article: "/article",
  find_article: "/article",
  find_article_fast: "/article",
  boss_assault: "/boss",
  boss_damage: "/boss",
  win_battle: "/battle",
  upgrade: "/upgrade",
  daily_quests: "/quests",
};

const rank = (r: Rarity) => RARITIES.indexOf(r);

/** Avancement d'une quête apporté par un événement (0 : sans effet). */
export function questProgress(kind: QuestKind, e: GameEvent): number {
  switch (kind) {
    case "open_packs":
      return e.type === "pack_opened" ? 1 : 0;
    case "pull_sr":
      return e.type === "pack_opened" ? e.rarities.filter((r) => rank(r) >= rank("SR")).length : 0;
    case "pull_ur":
      return e.type === "pack_opened" ? e.rarities.filter((r) => rank(r) >= rank("UR")).length : 0;
    case "recycle_cards":
      return e.type === "recycled" ? e.rarities.length : 0;
    case "spin_wheel":
      return e.type === "wheel_spun" ? 1 : 0;
    case "play_article":
      return e.type === "article_played" ? 1 : 0;
    case "find_article":
      return e.type === "article_played" && e.found ? 1 : 0;
    case "find_article_fast":
      return e.type === "article_played" && e.found && e.guesses <= ARTICLE_FAST_GUESSES ? 1 : 0;
    case "boss_assault":
      return e.type === "boss_assault" ? 1 : 0;
    case "boss_damage":
      return e.type === "boss_assault" ? e.damage : 0;
    case "win_battle":
      return e.type === "battle_finished" && e.won ? 1 : 0;
    case "upgrade":
      return e.type === "upgrade" ? 1 : 0;
    case "daily_quests":
      return e.type === "quest_completed" && e.period === "day" ? 1 : 0;
  }
}

/** Quêtes du jour d'un joueur : une par créneau, trois types différents. */
export function dailyQuests(userId: string, day: string): (QuestDef & { tier: QuestTier })[] {
  const out: (QuestDef & { tier: QuestTier })[] = [];
  for (const tier of DAILY_TIERS) {
    const rand = seededRandom(`quest:${userId}:${day}:${tier}`);
    const options = QUEST_POOL[tier].filter((q) => !out.some((o) => o.kind === q.kind));
    out.push({ ...options[Math.floor(rand() * options.length)]!, tier });
  }
  return out;
}

/** Quête de remplacement (une par jour) : même créneau, un type absent des quêtes du jour. */
export function rerollQuest(userId: string, day: string, tier: QuestTier, current: QuestKind[]): QuestDef | null {
  const options = QUEST_POOL[tier].filter((q) => !current.includes(q.kind));
  if (!options.length) return null;
  const rand = seededRandom(`reroll:${userId}:${day}:${tier}`);
  return options[Math.floor(rand() * options.length)]!;
}

/** Quête de la semaine (lundi en heure de Paris) : la même pour tous, en rotation. */
export function weeklyQuest(day: string): QuestDef & { tier: "weekly"; week: string } {
  const week = weekStart(day);
  const index = Math.floor(new Date(`${week}T00:00:00Z`).getTime() / (7 * 86_400_000));
  const pool = QUEST_POOL.weekly;
  return { ...pool[((index % pool.length) + pool.length) % pool.length]!, tier: "weekly", week };
}
