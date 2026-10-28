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
  /** Images de blessures, de gore et de maladies floutées jusqu'au clic. */
  hideGore: boolean;
  /** Images de nudité floutées jusqu'au clic. */
  hideNudity: boolean;
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
  /** Admin : suggestions et réponses d'auteurs pas encore ouvertes (pastille du menu). 0 pour les autres joueurs. */
  newSuggestions: number;
  /** Passe de saison : niveau, XP dans le niveau en cours et XP du niveau (0 au niveau maximal). */
  pass: { level: number; into: number; need: number; xp: number };
  /** Quêtes terminées (jour + semaine) sur le total. */
  quests: { done: number; total: number };
  /** Essais de « Plus ou moins vu » restants aujourd'hui. */
  hlTriesLeft: number;
  /** Boss du jour : assauts restants pour le joueur, phase en cours. */
  boss: { assaultsLeft: number; phase: number };
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

/** Boutique du jour du joueur (sélection figée à la première visite, renouvelée à minuit heure de Paris). */
export interface ShopDTO {
  /** Jour de Paris (AAAA-MM-JJ). */
  day: string;
  /** Prochain renouvellement (minuit, heure de Paris). */
  resetsAt: string;
  items: { slot: number; price: number; purchased: boolean; card: CardDTO }[];
}

/** Achat en boutique : l'exemplaire créé, brillant ou non (tiré à l'achat). */
export interface ShopBuyDTO {
  slot: number;
  instanceId: number;
  shiny: boolean;
  wallet: Wallet;
}

/** Objectif communautaire de la saison (page Succès), lu dans le cache recalculé toutes les 10 minutes. */
export interface CommunityGoalDTO {
  season: number;
  /** Articles différents de la saison tirés par au moins un joueur. */
  distinctCards: number;
  /** Articles de la saison. */
  seasonCards: number;
  tiersReached: number;
  /** Heure du dernier calcul (null : pas encore calculé). */
  computedAt: string | null;
  /** Le joueur a ouvert au moins un paquet cette saison (condition pour les récompenses). */
  eligible: boolean;
  /** Paliers déjà versés au joueur (1 = premier). */
  rewardedTiers: number[];
  tiers: { cards: number; pw: number; packs: number }[];
}

/** Carte engagée dans un upgrade en série (aperçu, récapitulatif et historique). */
export interface UpgradeSeriesCardDTO {
  instanceId: number;
  cardId: number;
  title: string;
  rarity: Rarity;
  shiny: boolean;
  /** Aperçu seulement : favori (jamais pris sans que le joueur l'ajoute lui-même). */
  favorite?: boolean;
  /** Aperçu seulement : dernier exemplaire de l'article (il quitterait la collection). */
  lastCopy?: boolean;
}

/** Lot d'un upgrade en série lancé : cartes parties, tirage, carte obtenue ou PW rendus. */
export interface UpgradeSeriesLotDTO {
  cards: number;
  chance: number;
  roll: number;
  success: boolean;
  refund: number;
  consumed: UpgradeSeriesCardDTO[];
  won: UpgradeSeriesCardDTO | null;
}

/** Upgrade en série déjà lancé (liste des dernières séries de la page Upgrader). */
export interface UpgradeSeriesRunDTO {
  id: number;
  rarity: Rarity;
  target: Rarity;
  createdAt: string;
  successes: number;
  refund: number;
  lots: UpgradeSeriesLotDTO[];
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
  /**
   * Lots possibles au prochain lancement (au plus `maxLots`), chance en points de base (sur 10 000). Le joueur
   * peut n'en lancer que les premiers (`lots` du POST).
   */
  lots: { cards: number; chance: number }[];
  /** Cartes engagées si tous les lots possibles partent. */
  cards: number;
  /** Nombre moyen de réussites. */
  expectedSuccesses: number;
  /** PW rendus si tous les lots échouent. */
  refundIfAllFail: number;
  maxLots: number;
  /** Cartes prises automatiquement, dans l'ordre des lots (les `cards` premières partent si tout est lancé). */
  candidates: UpgradeSeriesCardDTO[];
}

export interface UpgradeSeriesResultDTO {
  /** Ligne de l'historique (dernières séries). */
  id: number;
  rarity: Rarity;
  target: Rarity;
  lots: UpgradeSeriesLotDTO[];
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

/** Ce qu'est devenue une carte après un échange (historique) : fusionnée, recyclée, upgradée, vendue, échangée. */
export type CardFate = "fused" | "recycled" | "upgraded" | "sold" | "traded";

/** Carte d'un échange : l'exemplaire, ou sa photo prise à l'échange s'il a disparu depuis (`instanceId` null). */
export type TradeCardDTO = CardDTO & { fate: CardFate | null };

export interface TradeDTO {
  id: number;
  from: { id: string; name: string; username: string };
  to: { id: string; name: string; username: string };
  give: TradeCardDTO[];
  want: TradeCardDTO[];
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
  /** Niveau atteint ; dépasse `maxLevel` avec les niveaux supplémentaires. */
  level: number;
  into: number;
  need: number;
  /** Dernier niveau de la carte (200). */
  maxLevel: number;
  /** Dernier niveau du recto de la carte (100) ; le verso porte les suivants. */
  halfLevel: number;
  /** PW de chaque niveau supplémentaire, au-delà de `maxLevel`. */
  overflowPw: number;
  /** Les 200 paliers de la carte et leur récompense. */
  levels: PassLevelDTO[];
  /** Fin de la saison (le passe repart de 0). */
  endsAt: string | null;
  /** XP par action, pour la légende « Comment gagner de l'XP ». */
  xpTable: { label: string; xp: number }[];
}

/** Article montré par « Plus ou moins vu » : titre, image, description courte. Jamais sa rareté ni ses vues. */
export interface HlArticleDTO {
  title: string;
  thumbUrl: string | null;
  description: string | null;
  /** Thème de filtre d'images que le joueur floute (image floue jusqu'au clic) ; null : rien à flouter. */
  veil?: "arthropods" | "gore" | "nudity" | null;
}

/** Paire en cours d'un essai : l'article resté à l'écran (`kept`) et le nouveau (`challenger`). */
export interface HlPairDTO {
  tryNo: number;
  /** Numéro de la paire dans l'essai : à renvoyer avec la réponse. */
  step: number;
  streak: number;
  kept: HlArticleDTO;
  challenger: HlArticleDTO;
  /** Échéance du choix (le serveur ajoute 1 s de marge). */
  deadline: string;
  /** Temps restant vu du serveur à l'envoi. */
  msLeft: number;
  durationMs: number;
  /** PW si l'essai s'arrête maintenant, et après une réussite de plus (0 à l'entraînement). */
  reward: number;
  nextReward: number;
  /** Entraînement, après les 3 essais du jour : ni PW, ni XP, ni quête, ni succès, ni classement. */
  practice: boolean;
  /** Paire tirée de zéro : aucun article ne convenait face à l'article gardé, les deux sont nouveaux. */
  renewed: boolean;
}

/** Journée de « Plus ou moins vu » du joueur. */
export interface HlStateDTO {
  day: string;
  maxTries: number;
  triesLeft: number;
  current: HlPairDTO | null;
  /** Essais finis du jour. */
  runs: { tryNo: number; streak: number; reward: number; endReason: "wrong" | "timeout" | "exhausted" | null }[];
  todayBest: number;
  /** Série record du joueur (tous jours confondus). */
  best: number;
  /** Réussites cumulées depuis le début. */
  totalWins: number;
  earnedToday: number;
  resetsAt: string;
  /** Entraînement du jour (après les 3 essais) : parties jouées et meilleure série, hors classement. */
  practice: { played: number; todayBest: number };
}

/** Réponse à une paire : vues révélées, issue, paire suivante ou fin de l'essai. */
export interface HlAnswerDTO {
  correct: boolean;
  timeout: boolean;
  reveal: { kept: { title: string; views: number }; challenger: { title: string; views: number } };
  streak: number;
  /** PW gagnés à la fin de l'essai (null : l'essai continue). */
  reward: number | null;
  next: HlPairDTO | null;
  state: HlStateDTO;
}

export type ArticleCategoryKey = "personne" | "lieu" | "oeuvre" | "organisation" | "autre";

export interface BossQuestionDTO {
  idx: number;
  /** Carte qui attaque ; sans titre, image ni identifiant quand elle est face cachée. */
  card: CardDTO;
  /** Question dont la carte donnerait la réponse (image) : carte face cachée. */
  cardHidden: boolean;
  type: string;
  /** `choice` : un choix parmi `choices` ; `year` : une année à taper. */
  input: "choice" | "year";
  prompt: string;
  choices: string[];
  /** Catégorie de l'article et son multiplicateur du jour (×2 faiblesse, ×0,5 résistance). */
  category: ArticleCategoryKey;
  mult: number;
  /** Temps restant pour répondre (ms) au moment de l'envoi. */
  remainingMs: number;
  durationMs: number;
  /**
   * Affichage déjà déclaré (`POST …/shown`) : le chrono tourne depuis. Sinon il partira de l'affichage, au plus tard
   * `shownCapMs` après l'envoi.
   */
  shown: boolean;
  shownCapMs: number;
}

export interface BossHitDTO {
  idx: number;
  card: CardDTO;
  type: string;
  correct: boolean;
  /** Bonne réponse : index du choix, ou l'année (question à taper). */
  correctIndex: number | null;
  correctYear: number | null;
  choice: number | null;
  guessYear: number | null;
  answerMs: number | null;
  hit: "miss" | "hit" | "crit";
  category: ArticleCategoryKey;
  mult: number;
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

export interface BossPhaseDTO {
  phase: number;
  maxHp: number;
  /** Phase tombée : quand, et sous le coup de qui. */
  fallenAt: string | null;
  fallenBy: string | null;
}

export interface BossDTO {
  day: string;
  boss: CardDTO;
  bossCategory: ArticleCategoryKey;
  extract: string | null;
  /** Phase en cours, ses PV et ce qu'il en reste ; dégâts de la journée, toutes phases comprises. */
  phase: number;
  maxHp: number;
  hp: number;
  totalDamage: number;
  /** Phases tombées, puis la phase en cours. */
  phases: BossPhaseDTO[];
  rule: { weakness: ArticleCategoryKey; resistance: ArticleCategoryKey; weaknessMult: number; resistanceMult: number };
  assaultsPerDay: number;
  assaultsUsed: number;
  cardsPerAssault: number;
  /** Assaut en cours du joueur (question à répondre ou à demander). */
  current: BossAssaultDTO | null;
  myDamage: number;
  /** Ce que le joueur a déjà acquis aujourd'hui (versé à minuit). */
  earned: { pw: number; packs: number; phases: number[]; consolation: boolean; mvp: boolean; missing: number };
  ranking: { userId: string; name: string; username: string; damage: number; me: boolean }[];
  participants: number;
  rewards: {
    phases: { pw: number; packs: number }[];
    laterPhase: { pw: number; packs: number };
    mvpPacks: number;
    consolationPw: number;
    minDamage: number;
  };
  fatigueDays: number;
  nextAt: string;
}

/** Article de sa collection pour un assaut : catégorie, dégâts du jour, repos. */
export interface BossCardDTO {
  instanceId: number;
  cardId: number;
  title: string;
  rarity: Rarity;
  atk: number;
  level: number;
  shiny: boolean;
  /** Image de l'article (vignette du sélecteur), null s'il n'en a pas. */
  thumbUrl: string | null;
  category: ArticleCategoryKey;
  mult: number;
  /** Dégâts sur une bonne réponse et en critique, faiblesse ou résistance comprise. */
  damage: number;
  critDamage: number;
  /** Jours de repos restants (0 : jouable aujourd'hui). */
  restDays: number;
}

export interface BossCardsDTO {
  /** Articles jouables (les plus efficaces d'abord), puis les articles au repos. */
  items: BossCardDTO[];
  /** Articles jouables et articles possédés en tout. */
  available: number;
  total: number;
}

export interface BossLiveDTO {
  day: string;
  phase: number;
  hp: number;
  maxHp: number;
  totalDamage: number;
  /** Phases tombées par ce coup (en général aucune, parfois une). */
  fell: { phase: number; by: string }[];
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

/** Deck de bataille enregistré (privé). */
export interface SavedDeckDTO {
  id: number;
  name: string;
  /** Exemplaires du deck dans l'ordre : la carte, ou null si elle n'est plus dans ta collection. */
  cards: (CardDTO | null)[];
  /** Cartes qui ne sont plus dans ta collection (à remplacer avant de jouer ce deck). */
  missing: number;
  status: "ready" | "incomplete" | "invalid";
  updatedAt: string;
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
  /** Fil sous le retour de Palawi, du plus ancien au plus récent. */
  thread: SuggestionMessageDTO[];
}

/** Message du fil d'une suggestion : de son auteur ou de Palawi. */
export interface SuggestionMessageDTO {
  id: number;
  fromAdmin: boolean;
  body: string;
  createdAt: string;
}

/** Verdict du tri automatique : à coder, à trancher par l'admin, refus proposé, bug à corriger. */
/** prod : action à faire en production (contenu, données, page Admin), sans branche de code. */
export type TriageVerdict = "build" | "decision" | "non" | "bug" | "prod" | "saison";
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
  /** Réponses de l'auteur pas encore ouvertes par un admin. */
  unseenAnswers: number;
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

/**
 * Bannière d'un joueur (profil, classements) : image importée, servie par GET /banners/:userId?v=<version>,
 * ou carte de sa collection (image de l'article).
 */
export type BannerDTO =
  | {
      kind: "image";
      userId: string;
      /** Change à chaque nouvelle image (le navigateur garde l'ancienne en cache sinon). */
      version: string;
    }
  | {
      kind: "card";
      cardId: number;
      title: string;
      /** Rareté de son meilleur exemplaire de l'article. */
      rarity: Rarity;
      thumbUrl: string | null;
    };

// ---------------------------------------------------------------------------
// Succès vus sur le profil d'un autre joueur
// ---------------------------------------------------------------------------

export interface PublicAchievementDTO {
  key: string;
  family: string;
  tier: number;
  secret: boolean;
  name: string;
  description: string;
  target: number;
  /** Objectif en pourcentage : 1 = en %, 10 = en dixièmes de % ; null : un nombre. */
  percent: number | null;
  reward: { pw: number; packs: number };
  unlockedAt: string | null;
}

/** Succès d'un joueur pour son profil public : obtenus ou non, jamais sa progression. */
export interface PublicAchievementsDTO {
  unlocked: number;
  /** Succès comptés (secrets compris). */
  total: number;
  /** Secrets pas encore obtenus : comptés dans `total`, absents de `items`. */
  hiddenSecrets: number;
  items: PublicAchievementDTO[];
}

// ---------------------------------------------------------------------------
// Page publique d'une guilde
// ---------------------------------------------------------------------------

export interface PublicGuildDTO {
  id: number;
  name: string;
  tag: string;
  emblem: string;
  description: string;
  createdAt: string;
  season: number;
  /** Rang au classement des guildes de la saison (1 = en tête), sur `guilds`. */
  rank: number;
  guilds: number;
  /** Points de collection de la saison cumulés par les membres. */
  score: number;
  /** Rôle et points de la saison apportés au score de la guilde. */
  members: {
    username: string;
    displayName: string;
    avatar: string | null;
    role: "leader" | "officer" | "member";
    score: number;
  }[];
  maxMembers: number;
  /** Le visiteur en est membre : sa page est /guild. */
  member: boolean;
  /** Le visiteur, sans guilde, peut la rejoindre (pas complète). */
  canJoin: boolean;
}

// ---------------------------------------------------------------------------
// Filtres d'images (Admin)
// ---------------------------------------------------------------------------

/** Carte ajoutée à un thème (`flagged`) ou retirée d'un thème à la main dans Admin. */
export interface ImageFilterOverrideDTO {
  cardId: number;
  title: string;
  thumbUrl: string | null;
  theme: "arthropods" | "gore" | "nudity";
  flagged: boolean;
  by: string | null;
  createdAt: string;
}
