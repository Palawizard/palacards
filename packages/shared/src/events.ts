import type { Rarity } from "@palacards/game";
import type { BossLiveDTO, BroadcastDTO, CardDTO, FeedItemDTO } from "./dto.js";

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
  /** Article d'arthropode (option « flouter les arthropodes »), quand il vient d'être chargé. */
  arthropod?: boolean;
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
    senderUsername: string | null;
    senderAvatar: string | null;
    body: string;
    card: {
      cardId: number;
      season: number;
      title: string;
      rarity: Rarity;
      atk: number;
      def: number;
      thumbUrl: string | null;
    } | null;
    createdAt: string;
  }) => void;
  /** Liste des duels à relire (défi reçu, duel commencé, terminé…) ; `started` : le duel t'attend. */
  "battle:update": (b: { battleId: number; started?: boolean; opponent?: string }) => void;
  /** État complet d'un duel, poussé à chaque changement de phase (le client ne fait que l'afficher). */
  "battle:state": (s: BattleStateDTO) => void;
  /** Duels ouverts à relire (créé, annulé, accepté ou expiré), à tous les joueurs connectés. */
  "battle:open": (o: Record<string, never>) => void;
  /** Quêtes, passe ou succès ont avancé : relire. */
  "progress:update": (p: Record<string, never>) => void;
  /** PV du boss du jour (à tous les joueurs connectés). */
  "boss:update": (b: BossLiveDTO) => void;
  /** Nouveau tirage marquant dans le fil d'activité (à tous les joueurs connectés). */
  "feed:new": (item: FeedItemDTO) => void;
  /** Message serveur de l'admin, à afficher par-dessus la page. */
  "broadcast:new": (m: BroadcastDTO) => void;
}

export type BattlePhaseDTO = "lobby" | "attack" | "shield" | "question" | "reveal";

/** Carte d'un deck en duel. `card` est null pour une carte adverse pas encore révélée (titre caché). */
export interface BattleCardView {
  slot: number;
  rarity: Rarity;
  atk: number;
  def: number;
  /** Dégâts si elle touche, avant bouclier. */
  damage: number;
  /** Réduction en % si elle sert de bouclier. */
  shieldPct: number;
  attacked: boolean;
  shielded: boolean;
  card: CardDTO | null;
}

export interface BattleQuestionView {
  type: "definition" | "year" | "image" | "who_am_i" | "popular";
  prompt: string;
  /** Textes, ou URL d'images pour `image`. */
  choices: string[];
  titleHidden: boolean;
}

export interface BattleTurnView {
  turn: number;
  attackerId: string;
  defenderId: string;
  attack: BattleCardView;
  shield: BattleCardView | null;
  attackAuto: boolean;
  shieldAuto: boolean;
  question: BattleQuestionView | null;
  /** Rempli une fois la question résolue (réponse ou chrono écoulé). */
  outcome: {
    choice: number | null;
    correctIndex: number;
    correct: boolean;
    answerMs: number | null;
    rawDamage: number;
    shieldPct: number;
    damage: number;
    reflected: number;
    parry: "none" | "parry" | "perfect";
  } | null;
}

export interface BattlePlayerView {
  id: string;
  name: string;
  username: string;
  hp: number | null;
  online: boolean;
  /** Actions manquées d'affilée (abandon à 3). */
  idle: number;
}

export interface BattleStateDTO {
  id: number;
  status: "pending" | "declined" | "cancelled" | "active" | "finished";
  phase: BattlePhaseDTO | null;
  turn: number;
  totalTurns: number;
  maxHp: number;
  /** Temps restant dans la phase au moment de l'envoi (le client en déduit son échéance). */
  phaseRemainingMs: number | null;
  phaseDurationMs: number | null;
  isChallenger: boolean;
  /** Duel de l'ancien format (avant les PV) : seul le résultat est connu. */
  legacy: boolean;
  you: BattlePlayerView;
  them: BattlePlayerView;
  /** Qui attaque au tour en cours. */
  attackerId: string | null;
  myHand: BattleCardView[];
  theirHand: BattleCardView[];
  current: BattleTurnView | null;
  /** Tours terminés, du premier au dernier. */
  turns: BattleTurnView[];
  result: {
    outcome: "win" | "loss" | "draw";
    eloDelta: number | null;
    forfeitBy: "you" | "them" | null;
    reward: number | null;
  } | null;
  createdAt: string;
}

/** Événements envoyés par le client : validés côté serveur avec Zod. */
export interface ClientToServerEvents {
  "auction:watch": (auctionId: number) => void;
  "auction:unwatch": (auctionId: number) => void;
  "battle:join": (battleId: number) => void;
}
