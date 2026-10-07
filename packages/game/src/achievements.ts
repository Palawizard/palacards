import type { Rarity } from "./rarity.js";

// ---------------------------------------------------------------------------
// Succès à paliers
//
// Chaque action du jeu émet un événement ; l'événement fait avancer des statistiques par joueur
// (compteurs ou records), et chaque succès est un seuil sur une statistique. Une même statistique
// porte plusieurs paliers (bronze, argent, or, platine, diamant) : « Ouvrir 1, 10, 100, 500… paquets ».
// Les statistiques peuvent être recalculées depuis l'historique (rattrapage des anciens joueurs).
// ---------------------------------------------------------------------------

/** Événements du jeu qui font progresser les succès, les quêtes et le passe (émis par l'API après chaque action). */
export type GameEvent =
  | {
      type: "pack_opened";
      rarities: Rarity[];
      /** Exemplaires brillants, dans l'ordre des raretés (absent : aucun). */
      shinies?: boolean[];
      /** Titres tirés (succès secrets sur les titres). */
      titles?: string[];
      /** Booster à thème. */
      themed?: boolean;
    }
  /**
   * État de la collection, sur les seuls exemplaires obtenus par le joueur lui-même (paquet, upgrader, roue) :
   * une carte reçue par échange, achetée au marché ou donnée par l'admin ne compte pas (anti-farm entre amis).
   */
  | {
      type: "collection";
      uniqueCards: number;
      uniqueLegendary: number;
      uniqueUR: number;
      totalUR: number;
      /** Initiales différentes (A à Z) parmi ces articles. */
      initials?: number;
    }
  | { type: "sale"; price: number; /** Enchérisseurs distincts de la vente. */ bidders: number }
  | { type: "purchase" }
  | { type: "trade_done" }
  | { type: "battle_finished"; won: boolean; winStreak: number; /** Elo après le duel. */ elo?: number }
  | { type: "card_level"; level: number }
  | { type: "guild_joined" }
  | { type: "login_streak"; days: number }
  /** Premier passage du jour (bonus de connexion). */
  | { type: "daily_login" }
  | { type: "friends"; count: number }
  | { type: "wheel_spun" }
  | { type: "recycled"; rarities: Rarity[] }
  | { type: "upgrade"; success: boolean }
  | { type: "quest_completed"; period: "day" | "week" }
  | { type: "article_played"; found: boolean; /** Essais utilisés (1 à 6). */ guesses: number }
  | { type: "boss_assault"; damage: number }
  /** Récompense de chute touchée (à la chute, ou en renfort après). */
  | { type: "boss_killed"; lastHit: boolean }
  /** Meilleur assaillant de la journée, désigné à minuit. */
  | { type: "boss_mvp" }
  | { type: "pass_level"; level: number }
  /** Suggestions du joueur retenues par l'admin (statuts SUGGESTION_ACHIEVEMENT_STATUSES), recomptées. */
  | { type: "suggestions_retained"; count: number };

export const STAT_KEYS = [
  "packs_opened",
  "theme_packs_opened",
  "pulled_sr",
  "pulled_ur",
  "pulled_l",
  "shiny_pulled",
  "unique_cards",
  "unique_l",
  "ur_pct",
  "initials",
  "sales",
  "big_sales",
  "best_sale",
  "purchases",
  "trades",
  "battles_played",
  "battles_won",
  "best_win_streak",
  "elo_peak",
  "card_level_max",
  "fusions",
  "guild_joined",
  "friends",
  "login_streak_max",
  "wheel_spins",
  "recycled",
  "upgrades",
  "upgrades_won",
  "quests_daily",
  "quests_weekly",
  "articles_found",
  "articles_first_try",
  "boss_assaults",
  "boss_damage",
  "boss_kills",
  "boss_mvp",
  "pass_level",
  "suggestions_retained",
  // Secrets.
  "secret_meta",
  "secret_palindrome",
  "jackpot_pack",
  "rainbow_pack",
  "number_title",
  "short_title",
  "long_title",
  "shiny_l",
  "boss_last_hit",
  "article_failed",
  "recycled_l",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export interface StatUpdate {
  stat: StatKey;
  /** `add` : compteur ; `max` : record (garde la plus grande valeur). */
  op: "add" | "max";
  value: number;
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Titre palindrome d'au moins 5 lettres (« Laval », « Ésope reste ici et se repose »). */
export function isPalindromeTitle(title: string): boolean {
  const letters = strip(title).replace(/[^a-z0-9]/g, "");
  return letters.length >= 5 && letters === [...letters].reverse().join("");
}

/** Titre qui n'est qu'un nombre (« 1789 », « 42 »). */
export const isNumberTitle = (title: string) => /^\d[\d\s.,]*$/.test(title.trim());
/** Titre de deux signes ou moins (« Pi », « Ré »). */
export const isShortTitle = (title: string) => strip(title).replace(/[^a-z0-9]/g, "").length <= 2;
/** Titre d'au moins 80 caractères. */
export const isLongTitle = (title: string) => title.length >= 80;
/** L'article « Wikipédia » lui-même. */
export const isMetaTitle = (title: string) => strip(title).trim() === "wikipedia";

const atLeastRank = (r: Rarity, min: Rarity) =>
  ["C", "PC", "R", "SR", "UR", "L"].indexOf(r) >= ["C", "PC", "R", "SR", "UR", "L"].indexOf(min);

/** Statistiques modifiées par un événement. */
export function statUpdates(e: GameEvent): StatUpdate[] {
  const add = (stat: StatKey, value = 1): StatUpdate => ({ stat, op: "add", value });
  const max = (stat: StatKey, value: number): StatUpdate => ({ stat, op: "max", value });
  const out: StatUpdate[] = [];
  switch (e.type) {
    case "pack_opened": {
      out.push(add("packs_opened"));
      if (e.themed) out.push(add("theme_packs_opened"));
      const sr = e.rarities.filter((r) => r === "SR").length;
      const ur = e.rarities.filter((r) => r === "UR").length;
      const l = e.rarities.filter((r) => r === "L").length;
      if (sr) out.push(add("pulled_sr", sr));
      if (ur) out.push(add("pulled_ur", ur));
      if (l) out.push(add("pulled_l", l));
      const shinies = e.shinies ?? [];
      const nShiny = shinies.filter(Boolean).length;
      if (nShiny) out.push(add("shiny_pulled", nShiny));
      if (shinies.some((s, i) => s && e.rarities[i] === "L")) out.push(add("shiny_l"));
      if (e.rarities.filter((r) => atLeastRank(r, "UR")).length >= 2) out.push(add("jackpot_pack"));
      if (new Set(e.rarities).size >= 5) out.push(add("rainbow_pack"));
      for (const t of e.titles ?? []) {
        if (isMetaTitle(t)) out.push(add("secret_meta"));
        if (isPalindromeTitle(t)) out.push(add("secret_palindrome"));
        if (isNumberTitle(t)) out.push(add("number_title"));
        if (isShortTitle(t)) out.push(add("short_title"));
        if (isLongTitle(t)) out.push(add("long_title"));
      }
      break;
    }
    case "collection":
      out.push(max("unique_cards", e.uniqueCards), max("unique_l", e.uniqueLegendary));
      if (e.totalUR > 0) out.push(max("ur_pct", Math.floor((e.uniqueUR * 100) / e.totalUR)));
      if (e.initials !== undefined) out.push(max("initials", e.initials));
      break;
    case "sale":
      out.push(add("sales"), max("best_sale", e.price));
      if (e.price > 1_000 && e.bidders >= 2) out.push(add("big_sales"));
      break;
    case "purchase":
      out.push(add("purchases"));
      break;
    case "trade_done":
      out.push(add("trades"));
      break;
    case "battle_finished":
      out.push(add("battles_played"), max("best_win_streak", e.winStreak));
      if (e.won) out.push(add("battles_won"));
      if (e.elo !== undefined) out.push(max("elo_peak", e.elo));
      break;
    case "card_level":
      out.push(max("card_level_max", e.level), add("fusions"));
      break;
    case "guild_joined":
      out.push(max("guild_joined", 1));
      break;
    case "login_streak":
      out.push(max("login_streak_max", e.days));
      break;
    case "friends":
      out.push(max("friends", e.count));
      break;
    case "wheel_spun":
      out.push(add("wheel_spins"));
      break;
    case "recycled":
      if (e.rarities.length) out.push(add("recycled", e.rarities.length));
      if (e.rarities.includes("L")) out.push(add("recycled_l"));
      break;
    case "upgrade":
      out.push(add("upgrades"));
      if (e.success) out.push(add("upgrades_won"));
      break;
    case "quest_completed":
      out.push(add(e.period === "day" ? "quests_daily" : "quests_weekly"));
      break;
    case "article_played":
      if (e.found) {
        out.push(add("articles_found"));
        if (e.guesses === 1) out.push(add("articles_first_try"));
      } else out.push(add("article_failed"));
      break;
    case "boss_assault":
      out.push(add("boss_assaults"));
      if (e.damage > 0) out.push(add("boss_damage", e.damage));
      break;
    case "boss_killed":
      out.push(add("boss_kills"));
      if (e.lastHit) out.push(add("boss_last_hit"));
      break;
    case "boss_mvp":
      out.push(add("boss_mvp"));
      break;
    case "pass_level":
      out.push(max("pass_level", e.level));
      break;
    case "suggestions_retained":
      out.push(max("suggestions_retained", e.count));
      break;
  }
  return out;
}

/** Applique des mises à jour aux statistiques ; renvoie les statistiques qui ont changé. */
export function applyStatUpdates(stats: Map<StatKey, number>, updates: StatUpdate[]): Map<StatKey, number> {
  const changed = new Map<StatKey, number>();
  for (const u of updates) {
    const cur = changed.get(u.stat) ?? stats.get(u.stat) ?? 0;
    const next = u.op === "add" ? cur + u.value : Math.max(cur, u.value);
    if (next !== cur) changed.set(u.stat, next);
  }
  for (const [k, v] of changed) stats.set(k, v);
  return changed;
}

// ---------------------------------------------------------------------------
// Définitions
// ---------------------------------------------------------------------------

export const TIER_NAMES = ["Bronze", "Argent", "Or", "Platine", "Diamant"] as const;

export interface AchievementDef {
  key: string;
  /** Famille (une statistique, plusieurs paliers) : regroupement de la page Succès. */
  family: string;
  name: string;
  description: string;
  stat: StatKey;
  target: number;
  /** Palier dans la famille (0 = bronze… 4 = diamant). */
  tier: number;
  /** `badge` : récompense cosmétique, nom du badge affiché sur le profil (aucun effet de jeu). */
  reward: { pw: number; packs: number; badge?: string };
  /** Succès secret : nom et description cachés tant qu'il n'est pas débloqué. */
  secret?: boolean;
}

type Step = [
  key: string,
  target: number,
  name: string,
  reward: number | { pw?: number; packs?: number; badge?: string },
];

/** Une famille de paliers sur une même statistique ; `describe` formule l'objectif de chaque palier. */
function family(name: string, stat: StatKey, describe: (n: number) => string, steps: Step[]): AchievementDef[] {
  return steps.map(([key, target, title, reward], tier) => ({
    key,
    family: name,
    name: title,
    description: describe(target),
    stat,
    target,
    tier: Math.min(tier, TIER_NAMES.length - 1),
    reward:
      typeof reward === "number"
        ? { pw: reward, packs: 0 }
        : { pw: reward.pw ?? 0, packs: reward.packs ?? 0, ...(reward.badge ? { badge: reward.badge } : {}) },
  }));
}

/**
 * Succès « Boîte à idées » : seules comptent les suggestions retenues par l'admin (acceptées ou réalisées) ;
 * en envoyer en rafale ne fait rien avancer.
 */
export const SUGGESTION_ACHIEVEMENT_STATUSES = ["accepted", "done"] as const;
/** Paliers « Boîte à idées » : suggestions retenues à atteindre, et nom du palier (qui est aussi celui du badge). */
export const SUGGESTION_ACHIEVEMENT_STEPS: [target: number, name: string][] = [
  [1, "Bonne idée"],
  [5, "Force de proposition"],
  [10, "Architecte du jeu"],
];
/** Famille « Boîte à idées » : récompensée par un badge de profil, sans PW (rien à farmer, rien à équilibrer). */
export const SUGGESTION_FAMILY = "Boîte à idées";

const n = (x: number) => x.toLocaleString("fr-FR");
const plural = (x: number, one: string, many: string) => (x > 1 ? many : one);
const secret = (key: string, stat: StatKey, name: string, description: string, pw: number): AchievementDef => ({
  key,
  family: "Secrets",
  name,
  description,
  stat,
  target: 1,
  tier: 0,
  reward: { pw, packs: 0 },
  secret: true,
});

/**
 * Tous les succès. Les clés des succès de la V1 (`first_pack`, `packs_100`, `legend_10`…) sont gardées :
 * ce qui est déjà débloqué le reste, sans être payé deux fois.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  ...family("Paquets ouverts", "packs_opened", (x) => `Ouvrir ${n(x)} ${plural(x, "paquet", "paquets")}.`, [
    ["first_pack", 1, "Premier paquet", 50],
    ["packs_10", 10, "Mise en bouche", 100],
    ["packs_100", 100, "Déballeur", { packs: 3 }],
    ["packs_500", 500, "Ciseaux affûtés", 600],
    ["packs_1000", 1_000, "Encyclopédiste", 2_000],
    ["packs_2500", 2_500, "Papier alu", 3_000],
    ["packs_5000", 5_000, "Usine à vignettes", 5_000],
    ["packs_10000", 10_000, "Bibliothèque d'Alexandrie", 10_000],
  ]),
  ...family(
    "Boosters à thème",
    "theme_packs_opened",
    (x) => `Ouvrir ${n(x)} ${plural(x, "booster", "boosters")} à thème.`,
    [
      ["theme_1", 1, "Édition limitée", 50],
      ["theme_10", 10, "Collectionneur d'éditions", 250],
      ["theme_50", 50, "Abonné aux nouveautés", 1_000],
      ["theme_100", 100, "Fan de la première heure", 2_500],
    ],
  ),
  ...family("Super rares", "pulled_sr", (x) => `Tirer ${n(x)} ${plural(x, "Super rare", "Super rares")}.`, [
    ["first_sr", 1, "Super !", 50],
    ["sr_25", 25, "Super collection", 150],
    ["sr_100", 100, "Super-héros", 400],
    ["sr_500", 500, "Super-nova", 1_500],
  ]),
  ...family("Ultra rares", "pulled_ur", (x) => `Tirer ${n(x)} ${plural(x, "Ultra rare", "Ultra rares")}.`, [
    ["first_ur", 1, "Ultra", 150],
    ["ur_10", 10, "Ultra-moderne", 400],
    ["ur_50", 50, "Ultraviolet", 1_500],
    ["ur_150", 150, "Ultime", 4_000],
  ]),
  ...family("Légendaires", "pulled_l", (x) => `Tirer ${n(x)} ${plural(x, "Légendaire", "Légendaires")}.`, [
    ["first_l", 1, "Légende", 500],
    ["l_5", 5, "Mythologie", 1_500],
    ["l_15", 15, "Épopée", 4_000],
    ["l_30", 30, "Olympe", 8_000],
  ]),
  ...family(
    "Brillantes",
    "shiny_pulled",
    (x) => `Tirer ${n(x)} ${plural(x, "carte brillante", "cartes brillantes")}.`,
    [
      ["shiny_1", 1, "Ça brille !", 300],
      ["shiny_5", 5, "Pie voleuse", 1_000],
      ["shiny_15", 15, "Boule à facettes", 3_000],
      ["shiny_50", 50, "Prisme", 8_000],
    ],
  ),
  ...family(
    "Articles différents",
    "unique_cards",
    (x) => `Posséder ${n(x)} articles différents tirés de ses propres paquets.`,
    [
      ["collection_100", 100, "Lecteur", 100],
      ["collection_1000", 1_000, "Bibliothécaire", 500],
      ["collection_5000", 5_000, "Archiviste", 1_500],
      ["collection_10000", 10_000, "Conservateur", 3_000],
      ["collection_25000", 25_000, "Encyclopédie vivante", 6_000],
    ],
  ),
  ...family(
    "Légendaires différentes",
    "unique_l",
    (x) => `Posséder ${n(x)} Légendaires différentes tirées de ses propres paquets.`,
    [
      ["legend_3", 3, "Trio de légende", 800],
      ["legend_10", 10, "Panthéon", 2_000],
      ["legend_25", 25, "Mont Olympe", 5_000],
    ],
  ),
  ...family(
    "Ultra rares de la saison",
    "ur_pct",
    (x) => `Posséder ${x} % des Ultra rares de la saison, tirées de ses propres paquets.`,
    [
      ["ur_1pct", 1, "Un centième de l'Olympe", 200],
      ["ur_5pct", 5, "Un vingtième de l'Olympe", 600],
      ["ur_10pct", 10, "Un dixième de l'Olympe", 1_000],
      ["ur_25pct", 25, "Un quart de l'Olympe", 3_000],
    ],
  ),
  ...family(
    "Abécédaire",
    "initials",
    (x) => `Posséder des articles commençant par ${x} lettres différentes, tirés de ses propres paquets.`,
    [
      ["abc_13", 13, "Demi-alphabet", 100],
      ["abc_26", 26, "De A à Z", 500],
    ],
  ),
  ...family("Ventes", "sales", (x) => `Vendre ${n(x)} ${plural(x, "carte", "cartes")} au marché.`, [
    ["first_sale", 1, "Marchand", 50],
    ["sales_10", 10, "Boutiquier", 200],
    ["sales_50", 50, "Négociant", 800],
    ["sales_200", 200, "Commissaire-priseur", 2_500],
  ]),
  ...family(
    "Coups de marteau",
    "big_sales",
    (x) =>
      x === 1
        ? "Vendre une carte plus de 1 000 PW, face à au moins deux enchérisseurs."
        : `Vendre ${n(x)} cartes plus de 1 000 PW, face à au moins deux enchérisseurs.`,
    [
      ["big_sale", 1, "Coup de marteau", 200],
      ["big_sale_5", 5, "Salle comble", 800],
    ],
  ),
  ...family("Record de vente", "best_sale", (x) => `Vendre une carte au moins ${n(x)} PW.`, [
    ["best_sale_5000", 5_000, "Pièce de collection", 500],
    // Seuil abaissé de 20 000 à 10 000 PW ; la clé reste celle d'origine : ce palier n'est jamais payé deux fois.
    ["best_sale_20000", 10_000, "Adjugé, vendu !", 1_500],
  ]),
  ...family("Achats", "purchases", (x) => `Remporter ${n(x)} ${plural(x, "enchère", "enchères")} au marché.`, [
    ["buy_1", 1, "Premier achat", 50],
    ["buy_10", 10, "Chineur", 200],
    ["buy_50", 50, "Acheteur compulsif", 800],
  ]),
  ...family("Échanges", "trades", (x) => `Conclure ${n(x)} ${plural(x, "échange", "échanges")}.`, [
    ["first_trade", 1, "Troc", 50],
    ["trades_10", 10, "Brocanteur", 300],
    ["trades_50", 50, "Marchand de tapis", 1_000],
  ]),
  ...family("Duels joués", "battles_played", (x) => `Terminer ${n(x)} ${plural(x, "duel", "duels")}.`, [
    ["first_battle", 1, "En garde", 50],
    ["battles_25", 25, "Habitué de l'arène", 200],
    ["battles_100", 100, "Gladiateur", 600],
    ["battles_500", 500, "Vétéran", 2_000],
  ]),
  ...family("Victoires", "battles_won", (x) => `Gagner ${n(x)} duels.`, [
    ["wins_10", 10, "Duelliste", 150],
    ["wins_50", 50, "Bretteur", 500],
    ["wins_100", 100, "Champion", 1_000],
    ["wins_250", 250, "Maître d'armes", 2_500],
    ["wins_500", 500, "Invincible", 5_000],
  ]),
  ...family("Séries de victoires", "best_win_streak", (x) => `Gagner ${n(x)} duels d'affilée.`, [
    ["streak_5", 5, "Invaincu", 300],
    ["streak_10", 10, "Implacable", 1_000],
    ["streak_20", 20, "Légende de l'arène", 3_000],
  ]),
  ...family("Elo", "elo_peak", (x) => `Atteindre ${n(x)} d'Elo en duel.`, [
    ["elo_1100", 1_100, "Prometteur", 100],
    ["elo_1200", 1_200, "Confirmé", 300],
    ["elo_1400", 1_400, "Expert", 1_000],
    ["elo_1600", 1_600, "Grand maître", 3_000],
  ]),
  ...family("Niveau de carte", "card_level_max", (x) => `Monter une carte au niveau ${x}.`, [
    ["level_2", 2, "Retouche", 50],
    ["level_3", 3, "Restauration", 100],
    ["level_5", 5, "Chef-d'œuvre", 300],
  ]),
  ...family("Fusions", "fusions", (x) => `Fusionner ${n(x)} fois des doublons.`, [
    ["fusions_10", 10, "Soudeur", 100],
    ["fusions_50", 50, "Forgeron", 400],
    ["fusions_200", 200, "Alchimiste", 1_500],
  ]),
  ...family("Guilde", "guild_joined", () => "Rejoindre une guilde.", [["join_guild", 1, "Compagnon", 50]]),
  ...family("Amis", "friends", (x) => `Avoir ${n(x)} ${plural(x, "ami", "amis")}.`, [
    ["friends_1", 1, "Premier contact", 25],
    ["friends_5", 5, "Bande de potes", 100],
    ["friends_10", 10, "Tablée", 300],
    ["friends_19", 19, "Toute la bande", 800],
  ]),
  ...family("Connexion", "login_streak_max", (x) => `Se connecter ${n(x)} jours d'affilée.`, [
    ["login_3", 3, "Revenant", 30],
    ["login_7", 7, "Assidu", { packs: 2 }],
    ["login_14", 14, "Fidèle", 300],
    ["login_30", 30, "Pilier", 1_000],
    ["login_60", 60, "Meuble", 2_500],
    ["login_100", 100, "Monument historique", 5_000],
  ]),
  ...family("Roue du jour", "wheel_spins", (x) => `Tourner la roue ${n(x)} ${plural(x, "fois", "fois")}.`, [
    ["wheel_1", 1, "Faites vos jeux", 25],
    ["wheel_30", 30, "Habitué du casino", 300],
    ["wheel_100", 100, "Croupier", 1_000],
    ["wheel_365", 365, "Une année de chance", 4_000],
  ]),
  ...family("Recyclage", "recycled", (x) => `Recycler ${n(x)} cartes.`, [
    ["recycle_100", 100, "Tri sélectif", 50],
    ["recycle_1000", 1_000, "Compost", 300],
    ["recycle_10000", 10_000, "Déchetterie", 1_500],
    ["recycle_50000", 50_000, "Écologiste", 5_000],
  ]),
  ...family("Upgrader", "upgrades", (x) => `Tenter ${n(x)} ${plural(x, "upgrade", "upgrades")}.`, [
    ["upgrade_1", 1, "Bricoleur", 25],
    ["upgrade_25", 25, "Joueur de dés", 200],
    ["upgrade_100", 100, "Flambeur", 600],
  ]),
  ...family("Upgrades réussis", "upgrades_won", (x) => `Réussir ${n(x)} ${plural(x, "upgrade", "upgrades")}.`, [
    ["upgrade_win_1", 1, "Ça passe !", 50],
    ["upgrade_win_10", 10, "Main heureuse", 300],
    ["upgrade_win_50", 50, "Insolente réussite", 1_200],
  ]),
  ...family("Quêtes du jour", "quests_daily", (x) => `Terminer ${n(x)} ${plural(x, "quête", "quêtes")} du jour.`, [
    ["quest_1", 1, "Aventurier", 25],
    ["quest_30", 30, "Coursier", 300],
    ["quest_100", 100, "Chasseur de primes", 1_000],
    ["quest_300", 300, "Héros du quotidien", 3_000],
  ]),
  ...family(
    "Quêtes de la semaine",
    "quests_weekly",
    (x) => `Terminer ${n(x)} ${plural(x, "quête", "quêtes")} de la semaine.`,
    [
      ["weekly_1", 1, "Semaine chargée", 200],
      ["weekly_4", 4, "Mois bien rempli", 600],
      ["weekly_12", 12, "Trimestre de feu", 2_000],
    ],
  ),
  ...family(
    "Article du jour",
    "articles_found",
    (x) => `Trouver ${n(x)} ${plural(x, "article", "articles")} du jour.`,
    [
      ["article_1", 1, "Détective", 50],
      ["article_7", 7, "Limier", 200],
      ["article_30", 30, "Sherlock", 800],
      ["article_100", 100, "Wikipédia ambulante", 2_500],
    ],
  ),
  ...family(
    "Du premier coup",
    "articles_first_try",
    (x) => `Trouver l'article du jour au premier indice ${n(x)} ${plural(x, "fois", "fois")}.`,
    [
      ["article_first_1", 1, "Éclair de génie", 200],
      ["article_first_10", 10, "Devin", 1_500],
    ],
  ),
  ...family(
    "Assauts de boss",
    "boss_assaults",
    (x) => `Lancer ${n(x)} ${plural(x, "assaut", "assauts")} contre le boss du jour.`,
    [
      ["boss_1", 1, "À l'assaut !", 25],
      ["boss_20", 20, "Fantassin", 300],
      ["boss_100", 100, "Chevalier", 1_200],
    ],
  ),
  ...family("Boss vaincus", "boss_kills", (x) => `Participer à la chute de ${n(x)} ${plural(x, "boss", "boss")}.`, [
    ["boss_kill_1", 1, "Tueur de géant", 200],
    ["boss_kill_10", 10, "Fléau des légendes", 800],
    ["boss_kill_30", 30, "Chasseur de mythes", 2_500],
  ]),
  ...family("Dégâts aux boss", "boss_damage", (x) => `Infliger ${n(x)} dégâts aux boss.`, [
    ["boss_dmg_1000", 1_000, "Coup de poing", 100],
    ["boss_dmg_10000", 10_000, "Bulldozer", 500],
    ["boss_dmg_50000", 50_000, "Apocalypse", 2_000],
  ]),
  ...family(
    "Meilleur assaillant",
    "boss_mvp",
    (x) => `Infliger le plus de dégâts au boss du jour ${n(x)} ${plural(x, "fois", "fois")}.`,
    [
      ["boss_mvp_1", 1, "Fer de lance", 300],
      ["boss_mvp_5", 5, "Terreur des boss", 1_000],
    ],
  ),
  ...family("Passe de saison", "pass_level", (x) => `Atteindre le niveau ${x} du passe de saison.`, [
    ["pass_10", 10, "Saison lancée", 100],
    ["pass_25", 25, "Mi-parcours", 300],
    ["pass_50", 50, "Cap des 50", 800],
    ["pass_100", 100, "Saison bouclée", 3_000],
  ]),
  ...family(
    SUGGESTION_FAMILY,
    "suggestions_retained",
    (x) => `Avoir ${n(x)} ${plural(x, "suggestion acceptée ou réalisée", "suggestions acceptées ou réalisées")}.`,
    SUGGESTION_ACHIEVEMENT_STEPS.map(([target, name]): Step => [`ideas_${target}`, target, name, { badge: name }]),
  ),
  secret("secret_meta", "secret_meta", "Mise en abyme", "Tirer l'article « Wikipédia ».", 500),
  secret(
    "secret_palindrome",
    "secret_palindrome",
    "Ésope reste ici",
    "Tirer un article dont le titre est un palindrome.",
    300,
  ),
  secret(
    "secret_jackpot",
    "jackpot_pack",
    "Coup double",
    "Tirer deux Ultra rares ou mieux dans le même paquet.",
    1_000,
  ),
  secret("secret_rainbow", "rainbow_pack", "Arc-en-ciel", "Tirer cinq raretés différentes dans le même paquet.", 300),
  secret("secret_number", "number_title", "Numérologue", "Tirer un article dont le titre est un nombre.", 100),
  secret("secret_short", "short_title", "Laconique", "Tirer un article au titre de deux lettres ou moins.", 150),
  secret("secret_long", "long_title", "Verbeux", "Tirer un article au titre d'au moins 80 caractères.", 150),
  secret("secret_shiny_l", "shiny_l", "Mythique", "Tirer une Légendaire brillante.", 10_000),
  secret("secret_last_hit", "boss_last_hit", "Coup de grâce", "Porter le coup fatal au boss du jour.", 500),
  secret("secret_article_fail", "article_failed", "Langue au chat", "Rater l'article du jour.", 50),
  secret("secret_recycle_l", "recycled_l", "Sacrilège", "Recycler une Légendaire.", 100),
];

export const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

/** Succès atteints par ces statistiques et pas encore débloqués. */
export function newlyUnlocked(stats: Map<StatKey, number>, unlocked: ReadonlySet<string>): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => !unlocked.has(a.key) && (stats.get(a.stat) ?? 0) >= a.target);
}

/** Badge de profil : celui du plus haut palier débloqué qui en donne un (null : aucun). */
export function achievementBadge(unlocked: ReadonlySet<string>): { name: string; tier: number } | null {
  let best: AchievementDef | null = null;
  for (const a of ACHIEVEMENTS) if (a.reward.badge && unlocked.has(a.key) && (!best || a.tier > best.tier)) best = a;
  return best?.reward.badge ? { name: best.reward.badge, tier: best.tier } : null;
}

/** Progression affichée d'un succès (plafonnée à l'objectif). */
export const achievementProgress = (a: AchievementDef, stats: Map<StatKey, number>) =>
  Math.min(stats.get(a.stat) ?? 0, a.target);
