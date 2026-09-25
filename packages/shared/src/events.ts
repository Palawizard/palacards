import type { Rarity } from "@palacards/game";
import type { CardDTO } from "./dto.js";

/** État du stock de paquets, calculé à la lecture. */
export interface PackState {
  available: number;
  bonus: number;
  max: number;
  /** Millisecondes avant le prochain paquet gratuit (0 si le stock est plein). */
  nextInMs: number;
  /** Paquets ouverts depuis la dernière UR/L, et seuil de la pity. */
  pity: number;
  pityThreshold: number;
}

export interface CardMedia {
  cardId: number;
  thumbUrl: string | null;
  extract: string | null;
  pageUrl: string | null;
}

export interface Wallet {
  balance: number;
  locked: number;
  /** Solde utilisable = balance − locked. */
  available: number;
}

export interface NotificationDTO {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/** Événements envoyés par le serveur (Socket.IO). */
export interface ServerToClientEvents {
  "packs:update": (state: PackState) => void;
  "wallet:update": (wallet: Wallet) => void;
  "card:media": (media: CardMedia) => void;
  "notification:new": (n: NotificationDTO & { unread: number }) => void;
  "auction:update": (a: {
    id: number;
    currentBid: number | null;
    currentBidder: string | null;
    currentBidderId: string | null;
    bidCount: number;
    endsAt: string;
    status: string;
  }) => void;
  "presence:update": (p: { userId: string; online: boolean }) => void;
  "message:new": (m: {
    id: number;
    channel: string;
    senderId: string;
    sender: string;
    body: string;
    card: { cardId: number; season: number; title: string; rarity: Rarity } | null;
    createdAt: string;
  }) => void;
  "battle:update": (b: { battleId: number }) => void;
  "battle:question": (q: BattleQuestionDTO) => void;
  "battle:round": (r: BattleRoundResultDTO) => void;
}

export interface BattleQuestionDTO {
  battleId: number;
  round: number;
  type: string;
  prompt: string;
  choices: string[];
  deadline: string;
  timeLimitMs: number;
  /** Temps restant au moment de l'envoi : le client en déduit son échéance sans dépendre de son horloge. */
  remainingMs: number;
  answered: boolean;
  yourCard: CardDTO;
  /** Carte adverse, révélée seulement après la réponse (ses stats trahiraient « plus lu » / « plus long »). */
  theirCard: CardDTO | null;
}

/** Réponse à `POST /battles/:id/rounds/:round/answer`. */
export interface BattleAnswerDTO {
  battleId: number;
  round: number;
  correctIndex: number;
  yourChoice: number | null;
  correct: boolean;
  yourPower: number;
  timeLeftMs: number;
  theirCard: CardDTO;
}

export interface BattleRoundResultDTO {
  battleId: number;
  round: number;
  correctIndex: number;
  yourChoice: number | null;
  yourPower: number;
  theirPower: number;
  winnerId: string | null;
  score: { you: number; them: number };
  finished: boolean;
}

/** Événements envoyés par le client : validés côté serveur avec Zod. */
export interface ClientToServerEvents {
  "auction:watch": (auctionId: number) => void;
  "auction:unwatch": (auctionId: number) => void;
  "battle:join": (battleId: number) => void;
}
