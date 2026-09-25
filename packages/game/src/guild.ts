import { addDays } from "./market.js";

export const GUILD_MAX_MEMBERS = 20;
export const GUILD_NAME_MIN = 3;
export const GUILD_NAME_MAX = 30;
export const GUILD_TAG_MIN = 2;
export const GUILD_TAG_MAX = 5;
/** Récompense d'un objectif hebdomadaire atteint : un paquet bonus par membre. */
export const GUILD_OBJECTIVE_REWARD_PACKS = 1;

export type GuildRole = "leader" | "officer" | "member";
export type GuildObjectiveKind = "pull_sr" | "open_packs" | "win_battles";

/** Objectifs hebdomadaires, en rotation : cible par membre (plancher pour les petites guildes). */
export const GUILD_OBJECTIVES: Record<
  GuildObjectiveKind,
  { label: (target: number) => string; perMember: number; min: number }
> = {
  pull_sr: { label: (n) => `Tirer ${n} cartes Super rare ou mieux`, perMember: 3, min: 10 },
  open_packs: { label: (n) => `Ouvrir ${n} paquets`, perMember: 25, min: 60 },
  win_battles: { label: (n) => `Gagner ${n} duels`, perMember: 2, min: 5 },
};
const ROTATION: GuildObjectiveKind[] = ["pull_sr", "open_packs", "win_battles"];

/** Lundi (jour calendaire) de la semaine d'un jour donné. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // lundi = 0
  return addDays(day, -offset);
}

/** Objectif d'une semaine : type en rotation selon le numéro de semaine, cible selon la taille de la guilde. */
export function weeklyObjective(week: string, members: number): { kind: GuildObjectiveKind; target: number } {
  const weekIndex = Math.floor(new Date(`${week}T00:00:00Z`).getTime() / (7 * 86_400_000));
  const kind = ROTATION[weekIndex % ROTATION.length]!;
  const def = GUILD_OBJECTIVES[kind];
  return { kind, target: Math.max(def.min, def.perMember * Math.max(1, members)) };
}

/** Ce qu'un rôle peut faire sur un autre membre. */
export function canManage(
  actor: GuildRole,
  target: GuildRole,
  action: "kick" | "promote" | "demote" | "transfer",
): boolean {
  if (action === "kick") return actor === "leader" ? target !== "leader" : actor === "officer" && target === "member";
  return actor === "leader" && target !== "leader";
}

export function validateGuildName(name: string): boolean {
  const n = name.trim();
  return n.length >= GUILD_NAME_MIN && n.length <= GUILD_NAME_MAX;
}

export function validateGuildTag(tag: string): boolean {
  return new RegExp(`^[A-Za-z0-9]{${GUILD_TAG_MIN},${GUILD_TAG_MAX}}$`).test(tag.trim());
}

/** Canal de messages privés entre deux joueurs (ids triés : un seul canal par paire). */
export function dmChannel(a: string, b: string): string {
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

export const guildChannel = (guildId: number) => `guild:${guildId}`;

/** Longueur maximale d'un message. */
export const MESSAGE_MAX_LENGTH = 1_000;
