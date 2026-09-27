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
  /** Emplacement dans la vitrine du profil (1 à 5). */
  pinnedSlot?: number | null;
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
  elo: number;
  /** Tour de roue quotidienne disponible aujourd'hui. */
  wheelReady: boolean;
  /** Boosters à thème en vente en ce moment (pastille du menu). */
  themesOnSale: number;
}

/** Booster à thème temporaire (page Paquets). */
export interface ThemeDTO {
  id: number;
  name: string;
  description: string;
  /** Catégories Wikipédia du thème (vide : liste de titres seulement). */
  categories: string[];
  price: number;
  startsAt: string;
  endsAt: string;
  /** En vente maintenant (sinon : à venir, ou terminé avec des boosters encore à ouvrir). */
  onSale: boolean;
  cardCount: number;
  /** Boosters de ce thème achetés ou reçus, pas encore ouverts. */
  owned: number;
  byRarity: Record<Rarity, number>;
  /** Cartes phares du thème (les plus rares). */
  preview: CardDTO[];
}

/** Roue quotidienne : état et cases (dans l'ordre d'affichage). */
export interface WheelDTO {
  ready: boolean;
  /** Prochain tour possible (minuit, heure de Paris). */
  nextAt: string;
  segments: { reward: WheelRewardDTO; weight: number }[];
}

export type WheelRewardDTO =
  { kind: "pw"; amount: number } | { kind: "packs"; amount: number } | { kind: "card"; rarity: "UR" | "L" };

export interface WheelSpinDTO {
  segment: number;
  reward: WheelRewardDTO;
  card: CardDTO | null;
  wallet: Wallet;
  packs: PackState;
  nextAt: string;
}

export interface UpgradeResultDTO {
  success: boolean;
  /** Chance de réussite (sur 10 000). */
  chance: number;
  /** Tirage (0 à 9 999) : réussite si inférieur à `chance`. La roue de l'upgrader s'arrête dessus. */
  roll: number;
  card: CardDTO | null;
  /** PW rendus en cas d'échec. */
  refund: number;
  wallet: Wallet;
}

export interface ReferencePriceDTO {
  median: number;
  min: number;
  max: number;
  count: number;
}

export interface AuctionDTO {
  id: number;
  card: CardDTO;
  sellerId: string;
  seller: string;
  startPrice: number;
  buyout: number | null;
  currentBid: number | null;
  currentBidder: string | null;
  currentBidderId: string | null;
  minBid: number;
  bidCount: number;
  endsAt: string;
  status: string;
  reference: ReferencePriceDTO | null;
}

export interface TradeDTO {
  id: number;
  from: { id: string; name: string; username: string };
  to: { id: string; name: string; username: string };
  give: CardDTO[];
  want: CardDTO[];
  fromPw: number;
  toPw: number;
  message: string | null;
  status: string;
  parentId: number | null;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
}
