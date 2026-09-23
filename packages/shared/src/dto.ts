import type { Rarity } from "@palacards/game";
import type { PackState, Wallet } from "./events.js";

/** Carte telle qu'affichée par le composant `Card` (exemplaire possédé ou article du catalogue). */
export interface CardDTO {
  /** Exemplaire possédé (null pour un article du catalogue). */
  instanceId: number | null;
  cardId: number;
  season: number;
  title: string;
  rarity: Rarity;
  /** Stats effectives (niveau compris). */
  atk: number;
  def: number;
  level: number;
  views12m?: number;
  favorite?: boolean;
  locked?: "auction" | "trade" | null;
  tags?: string[];
  thumbUrl: string | null;
  pageUrl: string | null;
  obtainedAt?: string;
  /** Catalogue : le joueur en possède au moins un exemplaire. */
  owned?: boolean;
  /** Collection : nombre d'exemplaires de cet article possédés. */
  copies?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface MeDTO {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  avatar: string | null;
  animationSpeed: "normal" | "fast" | "instant";
  wallet: Wallet;
  packs: PackState;
  unreadNotifications: number;
  unreadMessages: number;
  season: number;
}
