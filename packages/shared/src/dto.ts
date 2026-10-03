import type { AutoRecycleRarity, Rarity } from "@palacards/game";
import type { PackState, Wallet } from "./events.js";
import type { SuggestionKind, SuggestionStatus } from "./schemas.js";

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
  /** Version brillante (cosmétique). */
  shiny?: boolean;
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
  /** Recyclage automatique des cartes tirées (rareté maximale, null : désactivé). */
  autoRecycle: { max: AutoRecycleRarity | null; keepNew: boolean };
  wallet: Wallet;
  packs: PackState;
  unreadNotifications: number;
  unreadMessages: number;
  season: number;
  elo: number;
  /** Tour de roue quotidienne disponible aujourd'hui. */
  wheelReady: boolean;
  /** Boosters à thème en vente en ce moment. */
  themesOnSale: number;
  /** Boosters à thème achetés ou reçus, pas encore ouverts (pastille « Paquets » du menu). */
  themePacks: number;
  /** Nouveautés pas encore vues (pastille « Nouveau » du menu), ex. `battle-v2`. */
  newFeatures: string[];
  /** Bandeau « Une idée ? » à afficher (pas fermé ni suggestion envoyée depuis une semaine). */
  suggestionBanner: boolean;
  /** Admin : suggestions pas encore ouvertes (pastille du menu). 0 pour les autres joueurs. */
  newSuggestions: number;
  /** Passe de saison : niveau, XP dans le niveau en cours et XP du niveau (0 au niveau maximal). */
  pass: { level: number; into: number; need: number; xp: number };
  /** Quêtes terminées (jour + semaine) sur le total. */
  quests: { done: number; total: number };
  /** Article du jour pas encore joué. */
  articleReady: boolean;
  /** Boss du jour : encore debout, assauts restants pour le joueur. */
  boss: { alive: boolean; assaultsLeft: number };
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

// ---------------------------------------------------------------------------
// Contenu quotidien
// ---------------------------------------------------------------------------

export interface QuestDTO {
  period: "day" | "week";
  slot: number;
  tier: "easy" | "medium" | "hard" | "weekly";
  kind: string;
  label: string;
  /** Page où avancer la quête. */
  href: string;
  target: number;
  progress: number;
  reward: { pw: number; xp: number };
  completedAt: string | null;
  rerolled: boolean;
}

export interface QuestsDTO {
  daily: QuestDTO[];
  weekly: QuestDTO | null;
  rerollAvailable: boolean;
  /** Prochaines quêtes du jour (minuit) et de la semaine (lundi), heure de Paris. */
  resetsAt: string;
  weeklyResetsAt: string;
}

export interface PassLevelDTO {
  level: number;
  reward: { pw: number; packs: number };
}

export interface PassDTO {
  season: number;
  xp: number;
  level: number;
  into: number;
  need: number;
  maxLevel: number;
  /** Les 100 paliers et leur récompense. */
  levels: PassLevelDTO[];
  /** Fin de la saison (le passe repart de 0). */
  endsAt: string | null;
  /** XP par action, pour la légende « Comment gagner de l'XP ». */
  xpTable: { label: string; xp: number }[];
}

export interface ArticleClueDTO {
  kind: string;
  label: string;
  text?: string;
  image?: string;
}

export interface DailyArticleDTO {
  day: string;
  /** Numéro de l'article du jour (depuis le premier). */
  number: number;
  maxGuesses: number;
  guesses: string[];
  /** Indices dévoilés (un de plus par essai raté). */
  clues: ArticleClueDTO[];
  /** Titre en grille : mots séparés par trois espaces, cases par une espace, `_` pour une lettre cachée. */
  pattern: string;
  found: boolean;
  finished: boolean;
  reward: number;
  /** Gain possible au prochain essai. */
  nextReward: number;
  /** Une fois la partie finie : la carte à deviner. */
  answer: CardDTO | null;
  /** Ligne de partage (carrés de couleur). */
  share: string | null;
  /** Joueurs ayant trouvé aujourd'hui, sur ceux ayant joué. */
  stats: { found: number; played: number };
  nextAt: string;
}

export interface BossQuestionDTO {
  idx: number;
  /** Carte qui attaque ; sans titre, image ni identifiant quand elle est face cachée. */
  card: CardDTO;
  /** Question dont la carte donnerait la réponse (image, « Qui suis-je ? ») : carte face cachée. */
  cardHidden: boolean;
  type: string;
  prompt: string;
  choices: string[];
  /** Temps restant pour répondre (ms) au moment de l'envoi. */
  remainingMs: number;
  durationMs: number;
}

export interface BossHitDTO {
  idx: number;
  card: CardDTO;
  correct: boolean;
  correctIndex: number;
  choice: number | null;
  answerMs: number | null;
  hit: "miss" | "hit" | "crit";
  damage: number;
}

export interface BossAssaultDTO {
  id: number;
  number: number;
  hits: BossHitDTO[];
  question: BossQuestionDTO | null;
  damage: number;
  finished: boolean;
}

export interface BossDTO {
  day: string;
  boss: CardDTO;
  extract: string | null;
  maxHp: number;
  hp: number;
  killedAt: string | null;
  killedBy: string | null;
  assaultsPerDay: number;
  assaultsUsed: number;
  cardsPerAssault: number;
  /** Assaut en cours du joueur (question à répondre ou à demander). */
  current: BossAssaultDTO | null;
  myDamage: number;
  ranking: { userId: string; name: string; username: string; damage: number; me: boolean }[];
  participants: number;
  rewards: { kill: { pw: number; packs: number }; mvpPacks: number; consolationPw: number };
  nextAt: string;
}

export interface BossLiveDTO {
  day: string;
  hp: number;
  maxHp: number;
  killedAt: string | null;
  /** Dernier coup porté (affiché en direct). */
  last: { name: string; damage: number; hit: "miss" | "hit" | "crit" } | null;
}

export interface FeedItemDTO {
  id: number;
  card: CardDTO;
  user: { id: string; name: string; username: string; avatar: string | null };
  source: string;
  createdAt: string;
  genres: string[];
  reactions: { emoji: string; count: number; mine: boolean }[];
}

export interface FeedDTO {
  items: FeedItemDTO[];
  nextCursor: string | null;
}

export interface BroadcastDTO {
  id: number;
  title: string;
  body: string;
  tone: "info" | "update" | "event" | "warning";
  linkUrl: string | null;
  linkLabel: string | null;
  sentAt: string | null;
}

export interface AdminBroadcastDTO extends BroadcastDTO {
  status: "draft" | "sent" | "archived";
  createdAt: string;
  expiresAt: string | null;
  /** Joueurs l'ayant vu. */
  reads: number;
}

/** Suggestion d'un joueur, telle qu'il la voit (page Suggestions). */
export interface SuggestionDTO {
  id: number;
  kind: SuggestionKind;
  title: string;
  body: string;
  status: SuggestionStatus;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

/** Vue admin : avec l'auteur et l'état « déjà ouverte ». */
export interface AdminSuggestionDTO extends SuggestionDTO {
  author: { id: string; username: string; displayName: string } | null;
  seen: boolean;
  updatedAt: string;
}
