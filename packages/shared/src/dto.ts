import type { AutoRecycleRarity, DailyLoginRates, Rarity, WheelReward, WheelTier } from "@palacards/game";
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
  /** Images d'arthropodes floutées jusqu'au clic. */
  hideArthropods: boolean;
  /** Upgrader sans tour d'aiguille : le résultat s'affiche tout de suite. */
  quickUpgrade: boolean;
  /** Ses tags servent de filtre aux autres joueurs sur sa collection. */
  publicTags: boolean;
  /** Recyclage automatique des cartes tirées (rareté maximale, null : désactivé). */
  autoRecycle: { max: AutoRecycleRarity | null; keepNew: boolean };
  wallet: Wallet;
  packs: PackState;
  unreadNotifications: number;
  unreadMessages: number;
  season: number;
  elo: number;
  /** Autres joueurs dans la file de matchmaking des duels (pastille « Bataille » du menu). */
  battleQueue: number;
  /** Une roue du jour est prête à tourner maintenant. */
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
  /** Boss du jour : encore debout, assauts restants pour le joueur, récompense de chute déjà touchée. */
  boss: { alive: boolean; assaultsLeft: number; rewarded: boolean };
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
  /** Boosters de ce thème déjà ouverts par le joueur. */
  opened: number;
  byRarity: Record<Rarity, number>;
  /** Cartes phares du thème (les plus rares). */
  preview: CardDTO[];
}

/** Roues du jour (petite, moyenne, grande), dans l'ordre d'ouverture. */
export interface WheelDTO {
  wheels: WheelFaceDTO[];
  /** Prochaine roue à tourner aujourd'hui (null : les trois sont faites). */
  next: WheelTier | null;
  /** La prochaine roue est prête maintenant. */
  ready: boolean;
  /** Heure à laquelle la prochaine roue sera prête (null : prête, ou plus rien aujourd'hui). */
  availableAt: string | null;
  /** La prochaine roue ne serait prête qu'après minuit : perdue pour aujourd'hui. */
  missed: boolean;
  /** Minuit (Paris) : tout repart de la petite roue. */
  resetAt: string;
  /** Attente entre deux roues, en minutes. */
  gapMinutes: number;
  /** Booster à thème que donnent les cases « booster » (null : aucun en vente, deux paquets à la place). */
  theme: { id: number; name: string } | null;
}

export type WheelStatus = "done" | "ready" | "waiting" | "locked" | "missed";

export interface WheelFaceDTO {
  tier: WheelTier;
  status: WheelStatus;
  /** Prête à partir de (roue en attente seulement). */
  availableAt: string | null;
  segments: { reward: WheelRewardDTO; weight: number }[];
}

export type WheelRewardDTO = WheelReward;

/** Ce que le joueur a réellement reçu (un booster à thème devient des paquets si aucun n'est en vente). */
export type WheelPrizeDTO =
  Exclude<WheelReward, { kind: "theme" }> | { kind: "theme"; amount: number; themeId: number; themeName: string };

export interface WheelSpinDTO {
  tier: WheelTier;
  segment: number;
  reward: WheelRewardDTO;
  prize: WheelPrizeDTO;
  card: CardDTO | null;
  wallet: Wallet;
  packs: PackState;
  wheel: WheelDTO;
}

/** Upgrade en série : lots prévus avec les doublons d'une rareté (jamais favoris, brillantes ni cartes engagées). */
export interface UpgradeSeriesPreviewDTO {
  rarity: Rarity;
  target: Rarity;
  /** Cartes utilisables : les doublons, plus le dernier exemplaire de chaque article si demandé. */
  available: number;
  /** Doublons libres de cette rareté. */
  duplicates: number;
  /** Articles dont il ne reste qu'un exemplaire libre (pris seulement si le joueur coche la case). */
  singles: number;
  /** Articles qui quitteraient la collection avec ce lancement (0 sans la case). */
  singlesUsed: number;
  /** Lots du prochain lancement, chance en points de base (sur 10 000). */
  lots: { cards: number; chance: number }[];
  /** Cartes engagées par ce lancement (au plus `maxLots` lots par clic). */
  cards: number;
  /** Nombre moyen de réussites. */
  expectedSuccesses: number;
  /** PW rendus si tous les lots échouent. */
  refundIfAllFail: number;
  maxLots: number;
}

export interface UpgradeSeriesResultDTO {
  rarity: Rarity;
  target: Rarity;
  lots: { cards: number; chance: number; roll: number; success: boolean }[];
  successes: number;
  /** Cartes gagnées, dans l'ordre des lots. */
  cards: CardDTO[];
  refund: number;
  wallet: Wallet;
  /** Cartes de cette rareté encore utilisables après ce lancement (mêmes règles que le lancement). */
  remaining: number;
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
  /** Récompense de chute déjà touchée aujourd'hui (à la chute, ou en renfort après). */
  rewarded: boolean;
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

/** File de matchmaking des duels, vue par un joueur. */
export interface BattleQueueDTO {
  /** Autres joueurs qui attendent un adversaire (toi exclu). */
  waiting: number;
  /** Ta place dans la file : entrée et fin de l'attente ; null si tu n'y es pas. */
  mine: { since: string; expiresAt: string } | null;
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

/** Verdict du tri automatique : à coder, à trancher par l'admin, refus proposé, bug à corriger. */
/** prod : action à faire en production (contenu, données, page Admin), sans branche de code. */
export type TriageVerdict = "build" | "decision" | "non" | "bug" | "prod";
export type TriageCategory = "important" | "confort" | "bloat" | "refus" | "troll";
export type TriageStatus = "pending" | "running" | "done" | "error";
/**
 * Construction d'une branche : none (pas prévue), queued (plafond du jour atteint), published (issue créée),
 * running (Claude code), ready (pull request prête), failed, merged (dans dev), closed (abandonnée).
 */
export type BuildStatus = "none" | "queued" | "published" | "running" | "ready" | "failed" | "merged" | "closed";

export interface TriageQuestionDTO {
  question: string;
  options: string[];
  recommended: string;
}

/** Tri par Claude et branche construite pour une suggestion (vue admin). */
export interface SuggestionAutomationDTO {
  triageStatus: TriageStatus;
  attempts: number;
  error: string | null;
  verdict: TriageVerdict | null;
  category: TriageCategory | null;
  summary: string | null;
  reasoning: string | null;
  spec: string | null;
  questions: TriageQuestionDTO[];
  proposedReply: string | null;
  duplicateOf: number | null;
  injection: boolean;
  triagedAt: string | null;
  buildStatus: BuildStatus;
  issueUrl: string | null;
  prUrl: string | null;
  branch: string | null;
  ciConclusion: string | null;
  playerReply: string | null;
  announcement: string | null;
  updatedAt: string;
}

/** Vue admin : avec l'auteur, l'état « déjà ouverte » et l'automatisation (null : jamais triée). */
export interface AdminSuggestionDTO extends SuggestionDTO {
  author: { id: string; username: string; displayName: string } | null;
  seen: boolean;
  updatedAt: string;
  automation: SuggestionAutomationDTO | null;
}

/** Réglage du bonus de connexion quotidienne (page Admin). */
export interface AdminDailyLoginDTO {
  /** Montants appliqués à la prochaine connexion quotidienne. */
  rates: DailyLoginRates;
  /** Montants par défaut du code (sans réglage enregistré). */
  defaults: DailyLoginRates;
  /** Montants du lancement du jeu, pour comparer. */
  launch: DailyLoginRates;
  /** Dernière modification dans la page Admin (null : valeurs par défaut). */
  updatedAt: string | null;
}

/** Pseudo proposé pendant la saisie (échanges, duels, amis) : rien de plus que ce qu'affiche le profil public. */
export interface PlayerSuggestionDTO {
  username: string;
  displayName: string;
  avatar: string | null;
  friend: boolean;
}
