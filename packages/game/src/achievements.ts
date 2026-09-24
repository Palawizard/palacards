import type { Rarity } from "./rarity.js";

/** Événements du jeu qui font progresser les succès (émis par l'API après chaque action). */
export type GameEvent =
  | { type: "pack_opened"; rarities: Rarity[] }
  /**
   * État de la collection, sur les seuls exemplaires tirés par le joueur lui-même (`source = 'pack'`) :
   * une carte reçue par échange, achetée au marché ou donnée par l'admin ne compte pas (anti-farm entre amis).
   */
  | { type: "collection"; uniqueCards: number; uniqueLegendary: number; uniqueUR: number; totalUR: number }
  | { type: "sale"; price: number; /** Enchérisseurs distincts de la vente. */ bidders: number }
  | { type: "trade_done" }
  | { type: "battle_finished"; won: boolean; winStreak: number }
  | { type: "card_level"; level: number }
  | { type: "guild_joined" }
  | { type: "login_streak"; days: number }
  | { type: "friends"; count: number };

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  target: number;
  reward: { pw: number; packs: number };
  /** Nouvelle progression après l'événement (null : événement sans effet sur ce succès). */
  progress: (event: GameEvent, current: number) => number | null;
}

const count =
  (type: GameEvent["type"], by: (e: GameEvent) => number = () => 1) =>
  (e: GameEvent, cur: number) =>
    e.type === type ? cur + by(e) : null;
const atLeast = (type: GameEvent["type"], value: (e: GameEvent) => number) => (e: GameEvent, cur: number) =>
  e.type === type ? Math.max(cur, value(e)) : null;
const pulled = (r: Rarity) => (e: GameEvent) =>
  e.type === "pack_opened" ? e.rarities.filter((x) => x === r).length : 0;

/** Les succès de la V1 (docs/08-pages.md), récompenses de 50 à 2 000 PW ou en paquets. */
export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: "first_pack",
    name: "Premier paquet",
    description: "Ouvrir son premier paquet.",
    target: 1,
    reward: { pw: 50, packs: 0 },
    progress: count("pack_opened"),
  },
  {
    key: "packs_100",
    name: "Déballeur",
    description: "Ouvrir 100 paquets.",
    target: 100,
    reward: { pw: 0, packs: 3 },
    progress: count("pack_opened"),
  },
  {
    key: "packs_1000",
    name: "Encyclopédiste",
    description: "Ouvrir 1 000 paquets.",
    target: 1_000,
    reward: { pw: 2_000, packs: 0 },
    progress: count("pack_opened"),
  },
  {
    key: "first_sr",
    name: "Super !",
    description: "Tirer sa première Super rare.",
    target: 1,
    reward: { pw: 50, packs: 0 },
    progress: count("pack_opened", pulled("SR")),
  },
  {
    key: "first_ur",
    name: "Ultra",
    description: "Tirer sa première Ultra rare.",
    target: 1,
    reward: { pw: 150, packs: 0 },
    progress: count("pack_opened", pulled("UR")),
  },
  {
    key: "first_l",
    name: "Légende",
    description: "Tirer sa première Légendaire.",
    target: 1,
    reward: { pw: 500, packs: 0 },
    progress: count("pack_opened", pulled("L")),
  },
  {
    key: "legend_10",
    name: "Panthéon",
    description: "Posséder 10 Légendaires différentes tirées de ses propres paquets.",
    target: 10,
    reward: { pw: 2_000, packs: 0 },
    progress: atLeast("collection", (e) => (e.type === "collection" ? e.uniqueLegendary : 0)),
  },
  {
    key: "ur_10pct",
    name: "Un dixième de l'Olympe",
    description: "Posséder 10 % des Ultra rares de la saison, tirées de ses propres paquets.",
    target: 10,
    reward: { pw: 1_000, packs: 0 },
    progress: atLeast("collection", (e) =>
      e.type === "collection" && e.totalUR > 0 ? Math.floor((e.uniqueUR * 100) / e.totalUR) : 0,
    ),
  },
  {
    key: "collection_1000",
    name: "Bibliothécaire",
    description: "Posséder 1 000 articles différents tirés de ses propres paquets.",
    target: 1_000,
    reward: { pw: 500, packs: 0 },
    progress: atLeast("collection", (e) => (e.type === "collection" ? e.uniqueCards : 0)),
  },
  {
    key: "first_sale",
    name: "Marchand",
    description: "Vendre une carte au marché.",
    target: 1,
    reward: { pw: 50, packs: 0 },
    progress: count("sale"),
  },
  {
    key: "big_sale",
    name: "Coup de marteau",
    description: "Vendre une carte plus de 1 000 PW, face à au moins deux enchérisseurs.",
    target: 1,
    reward: { pw: 200, packs: 0 },
    progress: count("sale", (e) => (e.type === "sale" && e.price > 1_000 && e.bidders >= 2 ? 1 : 0)),
  },
  {
    key: "first_trade",
    name: "Troc",
    description: "Conclure un échange.",
    target: 1,
    reward: { pw: 50, packs: 0 },
    progress: count("trade_done"),
  },
  {
    key: "first_battle",
    name: "En garde",
    description: "Terminer son premier duel.",
    target: 1,
    reward: { pw: 50, packs: 0 },
    progress: count("battle_finished"),
  },
  {
    key: "wins_10",
    name: "Duelliste",
    description: "Gagner 10 duels.",
    target: 10,
    reward: { pw: 150, packs: 0 },
    progress: count("battle_finished", (e) => (e.type === "battle_finished" && e.won ? 1 : 0)),
  },
  {
    key: "wins_100",
    name: "Champion",
    description: "Gagner 100 duels.",
    target: 100,
    reward: { pw: 1_000, packs: 0 },
    progress: count("battle_finished", (e) => (e.type === "battle_finished" && e.won ? 1 : 0)),
  },
  {
    key: "streak_5",
    name: "Invaincu",
    description: "Gagner 5 duels d'affilée.",
    target: 5,
    reward: { pw: 300, packs: 0 },
    progress: atLeast("battle_finished", (e) => (e.type === "battle_finished" ? e.winStreak : 0)),
  },
  {
    key: "level_5",
    name: "Chef-d'œuvre",
    description: "Monter une carte au niveau 5.",
    target: 5,
    reward: { pw: 300, packs: 0 },
    progress: atLeast("card_level", (e) => (e.type === "card_level" ? e.level : 0)),
  },
  {
    key: "join_guild",
    name: "Compagnon",
    description: "Rejoindre une guilde.",
    target: 1,
    reward: { pw: 50, packs: 0 },
    progress: count("guild_joined"),
  },
  {
    key: "friends_5",
    name: "Bande de potes",
    description: "Avoir 5 amis.",
    target: 5,
    reward: { pw: 100, packs: 0 },
    progress: atLeast("friends", (e) => (e.type === "friends" ? e.count : 0)),
  },
  {
    key: "login_7",
    name: "Assidu",
    description: "Se connecter 7 jours d'affilée.",
    target: 7,
    reward: { pw: 0, packs: 2 },
    progress: atLeast("login_streak", (e) => (e.type === "login_streak" ? e.days : 0)),
  },
];

export const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

export interface AchievementUpdate {
  key: string;
  progress: number;
  /** Vient d'être débloqué par cet événement. */
  unlocked: boolean;
}

/** Applique un événement aux progressions actuelles (succès déjà débloqués ignorés). */
export function applyEvent(
  current: Map<string, { progress: number; unlocked: boolean }>,
  event: GameEvent,
): AchievementUpdate[] {
  const updates: AchievementUpdate[] = [];
  for (const def of ACHIEVEMENTS) {
    const state = current.get(def.key) ?? { progress: 0, unlocked: false };
    if (state.unlocked) continue;
    const next = def.progress(event, state.progress);
    if (next === null || next === state.progress) continue;
    const capped = Math.min(next, def.target);
    updates.push({ key: def.key, progress: capped, unlocked: capped >= def.target });
  }
  return updates;
}
