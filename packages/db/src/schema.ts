import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const tstz = (name: string) => timestamp(name, { withTimezone: true });
const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const userRef = (name: string) => text(name).references(() => user.id, { onDelete: "cascade" });

export const rarityEnum = pgEnum("rarity", ["C", "PC", "R", "SR", "UR", "L"]);

// ---------------------------------------------------------------------------
// Cartes (import) et saisons
// ---------------------------------------------------------------------------

/**
 * Une ligne par article Wikipédia FR et par saison.
 * Remplie par l'import (tools/import) via COPY, jamais par l'app.
 */
export const cards = pgTable(
  "cards",
  {
    id: bigint("id", { mode: "number" }).notNull(), // page_id Wikipédia
    season: smallint("season").notNull(),
    title: text("title").notNull(),
    rarity: rarityEnum("rarity").notNull(),
    atk: smallint("atk").notNull(),
    def: smallint("def").notNull(),
    views12m: bigint("views_12m", { mode: "number" }).notNull(),
    pageLen: integer("page_len").notNull(),
    randKey: doublePrecision("rand_key")
      .notNull()
      .default(sql`random()`),
    // Titre normalisé (minuscules, sans accents) calculé une fois : la recherche n'appelle plus unaccent ligne à ligne.
    searchTitle: text("search_title").generatedAlwaysAs(sql`lower(f_unaccent(title))`),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.id] }),
    index("cards_search_trgm_idx").using("gin", sql`${t.searchTitle} gin_trgm_ops`),
    index("cards_rarity_rand_idx").on(t.season, t.rarity, t.randKey),
    // Tris du catalogue paginé par curseur (keyset).
    index("cards_views_idx").on(t.season, t.views12m, t.id),
    index("cards_atk_idx").on(t.season, t.atk, t.id),
    index("cards_def_idx").on(t.season, t.def, t.id),
    index("cards_title_idx").on(t.season, t.title, t.id),
    // Recherches par article toutes saisons confondues (fiche carte, wishlist, résumés) : la PK commence par la saison.
    index("cards_id_idx").on(t.id),
  ],
);

/**
 * Table de chargement de l'import (COPY du CSV), vidée par `finish_card_load(season)`
 * qui contrôle les effectifs puis insère les cartes de la saison dans `cards`.
 */
export const cardsNext = pgTable("cards_next", {
  id: bigint("id", { mode: "number" }).notNull(),
  title: text("title").notNull(),
  rarity: rarityEnum("rarity").notNull(),
  atk: smallint("atk").notNull(),
  def: smallint("def").notNull(),
  views12m: bigint("views_12m", { mode: "number" }).notNull(),
  pageLen: integer("page_len").notNull(),
});

/** Saisons mensuelles. Une seule est `active` : c'est dans ses cartes qu'on tire. */
export const seasons = pgTable(
  "seasons",
  {
    id: smallint("id").primaryKey(),
    status: text("status", { enum: ["upcoming", "active", "archived"] }).notNull(),
    startedAt: tstz("started_at"),
    endsAt: tstz("ends_at"),
  },
  (t) => [
    uniqueIndex("seasons_one_active")
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
  ],
);

/** Résumé et image Wikipédia d'un article (cache de l'API REST), indépendant de la saison. */
export const wikiSummaries = pgTable("wiki_summaries", {
  pageId: bigint("page_id", { mode: "number" }).primaryKey(),
  extract: text("extract"),
  thumbUrl: text("thumb_url"),
  pageUrl: text("page_url"),
  /** Description courte (Wikidata) : questions « C'est quoi ? » des duels. */
  description: text("description"),
  /** Article d'arthropode (option « flouter les arthropodes ») ; null : pas encore calculé depuis ce résumé. */
  arthropod: boolean("arthropod"),
  /** Version du cache : 1 = avant la description (rechargée à la demande par les duels). */
  version: smallint("version").notNull().default(2),
  status: text("status", { enum: ["ok", "missing", "error"] }).notNull(),
  fetchedAt: tstz("fetched_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Authentification (Better Auth) : noms de clés imposés par l'adaptateur Drizzle
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: tstz("created_at").defaultNow().notNull(),
  updatedAt: tstz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  /** Rôle admin : attribué seulement par la CLI (`node dist/cli/admin.js grant <pseudo>`), jamais déduit du pseudo. */
  isAdmin: boolean("is_admin").notNull().default(false),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tstz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: userRef("user_id").notNull(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: userRef("user_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Joueurs, exemplaires, économie
// ---------------------------------------------------------------------------

/** État de jeu d'un compte (1–1 avec `user`). Toute modification de `balance` passe par `ledger`. */
export const players = pgTable(
  "players",
  {
    userId: userRef("user_id").primaryKey(),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    lockedBalance: bigint("locked_balance", { mode: "number" }).notNull().default(0),
    packsStored: smallint("packs_stored").notNull().default(10),
    packsUpdatedAt: tstz("packs_updated_at").notNull().defaultNow(),
    bonusPacks: integer("bonus_packs").notNull().default(0),
    pityCounter: integer("pity_counter").notNull().default(0),
    elo: integer("elo").notNull().default(1000),
    eloPeak: integer("elo_peak").notNull().default(1000),
    avatar: text("avatar"),
    animationSpeed: text("animation_speed", { enum: ["normal", "fast", "instant"] })
      .notNull()
      .default("normal"),
    /** Recyclage automatique à l'ouverture des paquets : rareté maximale recyclée (null : désactivé). */
    autoRecycleMax: text("auto_recycle_max", { enum: ["C", "PC", "R", "SR"] }),
    /** Garder les articles jamais possédés malgré le recyclage automatique. */
    autoRecycleKeepNew: boolean("auto_recycle_keep_new").notNull().default(true),
    /** Images d'arthropodes (araignées, insectes…) floutées jusqu'au clic. */
    hideArthropods: boolean("hide_arthropods").notNull().default(false),
    notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean>>().notNull().default({}),
    loginStreak: integer("login_streak").notNull().default(0),
    lastLoginDay: date("last_login_day"),
    /** Jour (Paris) des roues du jour déjà tournées (`wheel_step` d'entre elles). */
    lastWheelDay: date("last_wheel_day"),
    /** Roues tournées le jour `last_wheel_day` : 1 petite, 2 moyenne, 3 grande. */
    wheelStep: smallint("wheel_step").notNull().default(0),
    /** Heure du dernier tour de roue (la suivante s'ouvre 2 h 30 après). */
    wheelLastAt: tstz("wheel_last_at"),
    /** XP du passe de saison, valable pour la saison `pass_season` (une autre saison : on repart de 0). */
    seasonXp: integer("season_xp").notNull().default(0),
    passSeason: smallint("pass_season"),
    /** Plus haut niveau du passe déjà récompensé pour `pass_season`. */
    passRewarded: smallint("pass_rewarded").notNull().default(0),
    /** Version du rattrapage des statistiques de succès (recalcul depuis l'historique, une fois par version). */
    statsVersion: smallint("stats_version").notNull().default(0),
    /** Dernier jour (Paris) où une quête du jour a été changée. */
    lastQuestRerollDay: date("last_quest_reroll_day"),
    /** Nouveautés déjà vues (pastille « Nouveau » du menu), par clé : `battle-v2`… */
    seenFeatures: text("seen_features")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastSeenAt: tstz("last_seen_at"),
    /** Bandeau « Une idée ? » masqué jusqu'à cette date (fermé ou suggestion envoyée : une semaine). */
    suggestionBannerUntil: tstz("suggestion_banner_until"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("players_balance_ok", sql`${t.balance} >= ${t.lockedBalance} AND ${t.lockedBalance} >= 0`),
    check("players_packs_ok", sql`${t.packsStored} >= 0 AND ${t.bonusPacks} >= 0 AND ${t.pityCounter} >= 0`),
    check("players_xp_ok", sql`${t.seasonXp} >= 0`),
  ],
);

/** Octets bruts (bytea) : Buffer côté Node. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Photo de profil importée (256 px, webp / jpeg / png), à part de `players` pour ne jamais charger
 * les octets avec l'état de jeu. `players.avatar` pointe dessus (`img:<userId>.<version>`).
 */
export const playerAvatars = pgTable(
  "player_avatars",
  {
    userId: userRef("user_id").primaryKey(),
    image: bytea("image").notNull(),
    mime: text("mime", { enum: ["image/webp", "image/jpeg", "image/png"] }).notNull(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [check("player_avatars_size_ok", sql`octet_length(${t.image}) <= 150000`)],
);

/** Exemplaire possédé : stats figées au tirage (tampon d'édition = `season`). */
export const cardInstances = pgTable(
  "card_instances",
  {
    id: id(),
    ownerId: userRef("owner_id").notNull(),
    cardId: bigint("card_id", { mode: "number" }).notNull(),
    season: smallint("season").notNull(),
    rarity: rarityEnum("rarity").notNull(),
    atk: smallint("atk").notNull(),
    def: smallint("def").notNull(),
    level: smallint("level").notNull().default(1),
    /** Version brillante (cosmétique, ~0,1 % des tirages). */
    shiny: boolean("shiny").notNull().default(false),
    favorite: boolean("favorite").notNull().default(false),
    /** Engagée dans une enchère ou un échange : ni recyclage, ni fusion, ni double vente. */
    lockedBy: text("locked_by", { enum: ["auction", "trade"] }),
    pinnedSlot: smallint("pinned_slot"),
    /** `upgrade` (upgrader) et `wheel` (roue quotidienne) comptent, comme `pack`, pour les succès de collection. */
    source: text("source", { enum: ["pack", "market", "trade", "admin", "upgrade", "wheel", "boss"] }).notNull(),
    obtainedAt: tstz("obtained_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.season, t.cardId], foreignColumns: [cards.season, cards.id] }),
    index("card_instances_owner_card_idx").on(t.ownerId, t.cardId),
    // Contrôle de la clé étrangère à la purge des vieilles cartes, et détenteurs d'un article.
    index("card_instances_card_season_idx").on(t.cardId, t.season),
    index("card_instances_owner_obtained_idx").on(t.ownerId, t.obtainedAt),
    uniqueIndex("card_instances_pinned_uq")
      .on(t.ownerId, t.pinnedSlot)
      .where(sql`${t.pinnedSlot} IS NOT NULL`),
    check("card_instances_level_ok", sql`${t.level} BETWEEN 1 AND 5`),
    check("card_instances_pinned_ok", sql`${t.pinnedSlot} IS NULL OR ${t.pinnedSlot} BETWEEN 1 AND 5`),
  ],
);

export const userTags = pgTable(
  "user_tags",
  {
    instanceId: bigint("instance_id", { mode: "number" })
      .notNull()
      .references(() => cardInstances.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.instanceId, t.tag] }),
    check("user_tags_len", sql`char_length(${t.tag}) BETWEEN 1 AND 24`),
  ],
);

/**
 * Grand livre (ajout seulement) : points wiki (`pw`), paquets gratuits (`pack`), paquets bonus (`bonus_pack`),
 * boosters à thème (`theme_pack`, `ref_id` = `theme:<id>`) et cartes (`card`).
 */
export const ledger = pgTable(
  "ledger",
  {
    id: id(),
    userId: userRef("user_id").notNull(),
    kind: text("kind", { enum: ["pw", "bonus_pack", "pack", "card", "theme_pack"] })
      .notNull()
      .default("pw"),
    delta: bigint("delta", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    refId: text("ref_id"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_user_created_idx").on(t.userId, t.createdAt),
    check("ledger_delta_nonzero", sql`${t.delta} <> 0`),
  ],
);

// ---------------------------------------------------------------------------
// Marché, ventes, échanges, wishlist
// ---------------------------------------------------------------------------

export const auctions = pgTable(
  "auctions",
  {
    id: id(),
    // Nulle une fois l'exemplaire recyclé ou fusionné après la vente (carte, saison et rareté sont copiées ici).
    instanceId: bigint("instance_id", { mode: "number" }).references(() => cardInstances.id, { onDelete: "set null" }),
    sellerId: userRef("seller_id").notNull(),
    cardId: bigint("card_id", { mode: "number" }).notNull(),
    season: smallint("season").notNull(),
    rarity: rarityEnum("rarity").notNull(),
    shiny: boolean("shiny").notNull().default(false),
    startPrice: integer("start_price").notNull(),
    buyout: integer("buyout"),
    currentBid: integer("current_bid"),
    currentBidderId: userRef("current_bidder_id"),
    bidCount: integer("bid_count").notNull().default(0),
    endsAt: tstz("ends_at").notNull(),
    status: text("status", { enum: ["open", "sold", "expired", "cancelled"] })
      .notNull()
      .default("open"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    closedAt: tstz("closed_at"),
  },
  (t) => [
    index("auctions_status_ends_idx").on(t.status, t.endsAt),
    index("auctions_instance_idx").on(t.instanceId),
    uniqueIndex("auctions_open_instance_uq")
      .on(t.instanceId)
      .where(sql`${t.status} = 'open'`),
    check("auctions_prices_ok", sql`${t.startPrice} > 0 AND (${t.buyout} IS NULL OR ${t.buyout} >= ${t.startPrice})`),
  ],
);

export const bids = pgTable(
  "bids",
  {
    id: id(),
    auctionId: bigint("auction_id", { mode: "number" })
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    bidderId: userRef("bidder_id").notNull(),
    amount: integer("amount").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("bids_auction_idx").on(t.auctionId, t.createdAt), check("bids_amount_ok", sql`${t.amount} > 0`)],
);

export const sales = pgTable(
  "sales",
  {
    id: id(),
    cardId: bigint("card_id", { mode: "number" }).notNull(),
    rarity: rarityEnum("rarity").notNull(),
    price: integer("price").notNull(),
    auctionId: bigint("auction_id", { mode: "number" }).references(() => auctions.id),
    soldAt: tstz("sold_at").notNull().defaultNow(),
  },
  (t) => [index("sales_card_sold_idx").on(t.cardId, t.soldAt)],
);

export const trades = pgTable(
  "trades",
  {
    id: id(),
    fromId: userRef("from_id").notNull(),
    toId: userRef("to_id").notNull(),
    fromPw: integer("from_pw").notNull().default(0),
    toPw: integer("to_pw").notNull().default(0),
    message: text("message"),
    parentId: bigint("parent_id", { mode: "number" }),
    status: text("status", { enum: ["pending", "accepted", "declined", "cancelled", "expired", "countered"] })
      .notNull()
      .default("pending"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    expiresAt: tstz("expires_at").notNull(),
    resolvedAt: tstz("resolved_at"),
  },
  (t) => [
    index("trades_to_idx").on(t.toId, t.status),
    index("trades_from_idx").on(t.fromId, t.status),
    check("trades_pw_ok", sql`${t.fromPw} >= 0 AND ${t.toPw} >= 0`),
    check("trades_distinct", sql`${t.fromId} <> ${t.toId}`),
  ],
);

export const tradeItems = pgTable(
  "trade_items",
  {
    tradeId: bigint("trade_id", { mode: "number" })
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    instanceId: bigint("instance_id", { mode: "number" })
      .notNull()
      .references(() => cardInstances.id, { onDelete: "cascade" }),
    side: text("side", { enum: ["from", "to"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tradeId, t.instanceId] }), index("trade_items_instance_idx").on(t.instanceId)],
);

export const wishlist = pgTable(
  "wishlist",
  {
    userId: userRef("user_id").notNull(),
    cardId: bigint("card_id", { mode: "number" }).notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cardId] }), index("wishlist_card_idx").on(t.cardId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: userRef("user_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    readAt: tstz("read_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Événements : boosters à thème, codes promo
// ---------------------------------------------------------------------------

/**
 * Booster à thème temporaire : articles d'une catégorie Wikipédia (et titres ajoutés à la main),
 * meilleurs taux, vendu en PW entre `starts_at` et `ends_at`. Les boosters achetés restent ouvrables après.
 */
export const themes = pgTable(
  "themes",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Catégorie Wikipédia source (sans le préfixe « Catégorie: »), null si liste de titres seule. */
    category: text("category"),
    price: integer("price").notNull(),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    /** Articles du thème présents dans les cartes au moment de la création. */
    cardCount: integer("card_count").notNull().default(0),
    /** Admin qui a créé le thème (sans clé étrangère : le thème survit au compte). */
    createdBy: text("created_by"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("themes_ends_idx").on(t.endsAt),
    check("themes_price_ok", sql`${t.price} > 0`),
    check("themes_dates_ok", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/** Articles d'un thème (identifiant de page Wikipédia, valable pour toutes les saisons). */
export const themeCards = pgTable(
  "theme_cards",
  {
    themeId: bigint("theme_id", { mode: "number" })
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    cardId: bigint("card_id", { mode: "number" }).notNull(),
  },
  // Index sur l'article seul : thèmes d'une carte (fiche carte).
  (t) => [primaryKey({ columns: [t.themeId, t.cardId] }), index("theme_cards_card_idx").on(t.cardId)],
);

/** Boosters à thème d'un joueur : achetés (ou reçus) pas encore ouverts, et nombre déjà ouverts. */
export const playerThemePacks = pgTable(
  "player_theme_packs",
  {
    userId: userRef("user_id").notNull(),
    themeId: bigint("theme_id", { mode: "number" })
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    count: integer("count").notNull().default(0),
    /** Boosters de ce thème ouverts (en stock ou achetés à l'ouverture). */
    opened: integer("opened").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.themeId] }),
    index("player_theme_packs_theme_idx").on(t.themeId),
    check("player_theme_packs_count_ok", sql`${t.count} >= 0`),
    check("player_theme_packs_opened_ok", sql`${t.opened} >= 0`),
  ],
);

/** Code promo : PW, paquets bonus et/ou boosters à thème, une fois par joueur. */
export const promoCodes = pgTable(
  "promo_codes",
  {
    /** En majuscules (saisie insensible à la casse). */
    code: text("code").primaryKey(),
    pw: integer("pw").notNull().default(0),
    packs: integer("packs").notNull().default(0),
    themeId: bigint("theme_id", { mode: "number" }).references(() => themes.id, { onDelete: "set null" }),
    themePacks: integer("theme_packs").notNull().default(0),
    /** Utilisations maximum, tous joueurs confondus (null : illimité). */
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    expiresAt: tstz("expires_at"),
    disabled: boolean("disabled").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("promo_codes_amounts_ok", sql`${t.pw} >= 0 AND ${t.packs} >= 0 AND ${t.themePacks} >= 0`),
    check("promo_codes_uses_ok", sql`${t.uses} >= 0 AND (${t.maxUses} IS NULL OR ${t.uses} <= ${t.maxUses})`),
    check("promo_codes_code_ok", sql`${t.code} ~ '^[A-Z0-9_-]{3,32}$'`),
  ],
);

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    code: text("code")
      .notNull()
      .references(() => promoCodes.code, { onDelete: "cascade" }),
    userId: userRef("user_id").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.code, t.userId] }), index("promo_redemptions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

/** Amitié stockée une fois, avec `user_a < user_b`. */
export const friendships = pgTable(
  "friendships",
  {
    userA: userRef("user_a").notNull(),
    userB: userRef("user_b").notNull(),
    requestedBy: userRef("requested_by").notNull(),
    status: text("status", { enum: ["pending", "accepted"] }).notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userA, t.userB] }),
    index("friendships_b_idx").on(t.userB),
    check("friendships_order", sql`${t.userA} < ${t.userB}`),
  ],
);

/** Canal `dm:<idA>:<idB>` (ids triés) ou `guild:<id>`. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    channel: text("channel").notNull(),
    senderId: userRef("sender_id").notNull(),
    body: text("body").notNull(),
    cardId: bigint("card_id", { mode: "number" }),
    cardSeason: smallint("card_season"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("messages_channel_idx").on(t.channel, t.createdAt),
    check("messages_body_len", sql`char_length(${t.body}) BETWEEN 0 AND 1000`),
  ],
);

export const messageReads = pgTable(
  "message_reads",
  {
    userId: userRef("user_id").notNull(),
    channel: text("channel").notNull(),
    lastReadAt: tstz("last_read_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channel] })],
);

export const guilds = pgTable(
  "guilds",
  {
    id: id(),
    name: text("name").notNull(),
    tag: text("tag").notNull(),
    emblem: text("emblem").notNull(),
    description: text("description").notNull().default(""),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("guilds_name_uq").on(sql`lower(${t.name})`),
    uniqueIndex("guilds_tag_uq").on(sql`lower(${t.tag})`),
  ],
);

export const guildMembers = pgTable(
  "guild_members",
  {
    userId: userRef("user_id").primaryKey(),
    guildId: bigint("guild_id", { mode: "number" })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["leader", "officer", "member"] }).notNull(),
    joinedAt: tstz("joined_at").notNull().defaultNow(),
  },
  (t) => [index("guild_members_guild_idx").on(t.guildId)],
);

export const guildObjectives = pgTable(
  "guild_objectives",
  {
    id: id(),
    guildId: bigint("guild_id", { mode: "number" })
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    kind: text("kind").notNull(),
    target: integer("target").notNull(),
    /** Compteur incrémenté au fil des événements (tirages, paquets, victoires) des membres de la semaine. */
    progress: integer("progress").notNull().default(0),
    completedAt: tstz("completed_at"),
  },
  (t) => [uniqueIndex("guild_objectives_week_uq").on(t.guildId, t.weekStart)],
);

// ---------------------------------------------------------------------------
// Batailles
// ---------------------------------------------------------------------------

export const battles = pgTable(
  "battles",
  {
    id: id(),
    challengerId: userRef("challenger_id").notNull(),
    opponentId: userRef("opponent_id").notNull(),
    status: text("status", { enum: ["pending", "declined", "cancelled", "active", "finished"] })
      .notNull()
      .default("pending"),
    seed: text("seed").notNull(),
    winnerId: userRef("winner_id"),
    /** Phase du duel en cours (null hors duel actif) ; l'état complet vit en base, jamais en mémoire. */
    phase: text("phase", { enum: ["lobby", "attack", "shield", "question", "reveal"] }),
    /** Tour en cours (1 à 8 ; 0 avant le premier). */
    turn: smallint("turn").notNull().default(0),
    phaseStartedAt: tstz("phase_started_at"),
    phaseEndsAt: tstz("phase_ends_at"),
    firstAttackerId: userRef("first_attacker_id"),
    /** PV (null : duel de l'ancien format, avant les PV). */
    challengerHp: smallint("challenger_hp"),
    opponentHp: smallint("opponent_hp"),
    /** Actions manquées d'affilée (chrono écoulé) : abandon au-delà de AFK_FORFEIT. */
    challengerIdle: smallint("challenger_idle").notNull().default(0),
    opponentIdle: smallint("opponent_idle").notNull().default(0),
    forfeitBy: userRef("forfeit_by"),
    challengerEloDelta: integer("challenger_elo_delta"),
    opponentEloDelta: integer("opponent_elo_delta"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
  },
  (t) => [
    index("battles_challenger_idx").on(t.challengerId, t.createdAt),
    index("battles_opponent_idx").on(t.opponentId, t.createdAt),
    check("battles_distinct", sql`${t.challengerId} <> ${t.opponentId}`),
  ],
);

/** Deck figé au moment du défi (les stats ne bougent plus même si la carte est vendue ensuite). */
export const battleDecks = pgTable(
  "battle_decks",
  {
    battleId: bigint("battle_id", { mode: "number" })
      .notNull()
      .references(() => battles.id, { onDelete: "cascade" }),
    userId: userRef("user_id").notNull(),
    slot: smallint("slot").notNull(),
    instanceId: bigint("instance_id", { mode: "number" }).notNull(),
    cardId: bigint("card_id", { mode: "number" }).notNull(),
    season: smallint("season").notNull(),
    rarity: rarityEnum("rarity").notNull(),
    atk: integer("atk").notNull(),
    def: integer("def").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.battleId, t.userId, t.slot] }),
    check("battle_decks_slot", sql`${t.slot} BETWEEN 1 AND 5`),
  ],
);

/** Un tour de duel : carte attaquante, bouclier, question et résultat. */
export const battleTurns = pgTable(
  "battle_turns",
  {
    battleId: bigint("battle_id", { mode: "number" })
      .notNull()
      .references(() => battles.id, { onDelete: "cascade" }),
    turn: smallint("turn").notNull(),
    attackerId: userRef("attacker_id").notNull(),
    defenderId: userRef("defender_id").notNull(),
    attackSlot: smallint("attack_slot").notNull(),
    attackAuto: boolean("attack_auto").notNull().default(false),
    shieldSlot: smallint("shield_slot"),
    shieldAuto: boolean("shield_auto").notNull().default(false),
    /** Question (bonne réponse comprise) : ne quitte jamais le serveur avant la réponse. */
    question: jsonb("question"),
    servedAt: tstz("served_at"),
    answeredAt: tstz("answered_at"),
    choice: smallint("choice"),
    correct: boolean("correct"),
    answerMs: integer("answer_ms"),
    rawDamage: smallint("raw_damage"),
    shieldPct: smallint("shield_pct"),
    damage: smallint("damage"),
    reflected: smallint("reflected"),
  },
  (t) => [
    primaryKey({ columns: [t.battleId, t.turn] }),
    check("battle_turns_turn", sql`${t.turn} BETWEEN 1 AND 8`),
    index("battle_turns_defender_idx").on(t.defenderId),
  ],
);

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

export const achievementsProgress = pgTable(
  "achievements_progress",
  {
    userId: userRef("user_id").notNull(),
    achievementKey: text("achievement_key").notNull(),
    progress: integer("progress").notNull().default(0),
    unlockedAt: tstz("unlocked_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementKey] })],
);

/** Classements figés en fin de saison. */
export const seasonArchives = pgTable(
  "season_archives",
  {
    season: smallint("season").notNull(),
    userId: userRef("user_id").notNull(),
    collectionScore: integer("collection_score").notNull(),
    elo: integer("elo").notNull(),
    wealth: bigint("wealth", { mode: "number" }).notNull(),
    guildId: bigint("guild_id", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.season, t.userId] })],
);

// ---------------------------------------------------------------------------
// Contenu quotidien : statistiques, quêtes, article du jour, boss, fil d'activité, messages serveur
// ---------------------------------------------------------------------------

/** Statistiques de succès par joueur (compteurs et records), recalculables depuis l'historique. */
export const playerStats = pgTable(
  "player_stats",
  {
    userId: userRef("user_id").notNull(),
    key: text("key").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/**
 * Paquets ouverts par joueur et par saison (classement « Boosters ouverts »), et « Chance » : points de collection
 * tirés (doublons compris) face à leur espérance, en dix-millièmes de point. `luckPacks` : paquets mesurés (le
 * journal des tirages ne remonte pas aux tout premiers paquets, comptés seulement dans `packs`).
 */
export const packStats = pgTable(
  "pack_stats",
  {
    userId: userRef("user_id").notNull(),
    season: smallint("season").notNull(),
    packs: integer("packs").notNull().default(0),
    luckPacks: integer("luck_packs").notNull().default(0),
    pulledPoints: bigint("pulled_points", { mode: "number" }).notNull().default(0),
    expectedPoints: bigint("expected_points", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.season] })],
);

/** Quêtes d'un joueur : trois par jour (créneaux 1 à 3) et une par semaine (créneau 1). */
export const playerQuests = pgTable(
  "player_quests",
  {
    userId: userRef("user_id").notNull(),
    period: text("period", { enum: ["day", "week"] }).notNull(),
    /** Jour (quêtes du jour) ou lundi de la semaine (heure de Paris). */
    periodStart: date("period_start").notNull(),
    slot: smallint("slot").notNull(),
    tier: text("tier", { enum: ["easy", "medium", "hard", "weekly"] }).notNull(),
    kind: text("kind").notNull(),
    target: integer("target").notNull(),
    progress: integer("progress").notNull().default(0),
    rewardPw: integer("reward_pw").notNull(),
    rewardXp: integer("reward_xp").notNull(),
    rerolled: boolean("rerolled").notNull().default(false),
    completedAt: tstz("completed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.period, t.periodStart, t.slot] }),
    check("player_quests_target_ok", sql`${t.target} > 0 AND ${t.progress} >= 0`),
  ],
);

/** Article du jour (le même pour tous) et ses indices, figés à la première demande du jour. */
export const dailyArticles = pgTable("daily_articles", {
  day: date("day").primaryKey(),
  cardId: bigint("card_id", { mode: "number" }).notNull(),
  season: smallint("season").notNull(),
  title: text("title").notNull(),
  rarity: rarityEnum("rarity").notNull(),
  clues: jsonb("clues").$type<{ kind: string; label: string; text?: string; image?: string }[]>().notNull(),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

/** Partie d'un joueur à l'article du jour. */
export const dailyGuesses = pgTable(
  "daily_guesses",
  {
    userId: userRef("user_id").notNull(),
    day: date("day").notNull(),
    guesses: jsonb("guesses").$type<string[]>().notNull().default([]),
    found: boolean("found").notNull().default(false),
    reward: integer("reward").notNull().default(0),
    finishedAt: tstz("finished_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/** Boss du jour : une Légendaire de la saison, PV partagés par tous les joueurs. */
export const bossDays = pgTable(
  "boss_days",
  {
    day: date("day").primaryKey(),
    cardId: bigint("card_id", { mode: "number" }).notNull(),
    season: smallint("season").notNull(),
    maxHp: integer("max_hp").notNull(),
    hp: integer("hp").notNull(),
    killedAt: tstz("killed_at"),
    killedBy: text("killed_by").references(() => user.id, { onDelete: "set null" }),
    /** Journée close à minuit : consolation (boss debout) ou meilleur assaillant et retardataires payés (boss tombé). */
    finalizedAt: tstz("finalized_at"),
  },
  (t) => [check("boss_days_hp_ok", sql`${t.hp} >= 0 AND ${t.hp} <= ${t.maxHp}`)],
);

/** Assaut d'un joueur contre le boss (2 par jour) : 5 cartes, 5 questions. */
export const bossAssaults = pgTable(
  "boss_assaults",
  {
    id: id(),
    day: date("day").notNull(),
    userId: userRef("user_id").notNull(),
    number: smallint("number").notNull(),
    damage: integer("damage").notNull().default(0),
    startedAt: tstz("started_at").notNull().defaultNow(),
    finishedAt: tstz("finished_at"),
  },
  (t) => [
    uniqueIndex("boss_assaults_day_user_uq").on(t.day, t.userId, t.number),
    index("boss_assaults_day_idx").on(t.day),
  ],
);

/**
 * Récompense de chute du boss versée à un joueur pour un jour : une seule fois, que ce soit à la chute,
 * en renfort (assaut fini après la chute) ou au rattrapage de minuit.
 */
export const bossRewards = pgTable(
  "boss_rewards",
  {
    day: date("day").notNull(),
    userId: userRef("user_id").notNull(),
    paidAt: tstz("paid_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.userId] })],
);

/** Question d'un assaut : carte jouée, question (bonne réponse comprise, jamais envoyée avant la réponse). */
export const bossHits = pgTable(
  "boss_hits",
  {
    assaultId: bigint("assault_id", { mode: "number" })
      .notNull()
      .references(() => bossAssaults.id, { onDelete: "cascade" }),
    idx: smallint("idx").notNull(),
    instanceId: bigint("instance_id", { mode: "number" }).notNull(),
    cardId: bigint("card_id", { mode: "number" }).notNull(),
    season: smallint("season").notNull(),
    rarity: rarityEnum("rarity").notNull(),
    atk: integer("atk").notNull(),
    question: jsonb("question"),
    servedAt: tstz("served_at"),
    answeredAt: tstz("answered_at"),
    choice: smallint("choice"),
    correct: boolean("correct"),
    answerMs: integer("answer_ms"),
    damage: integer("damage"),
  },
  (t) => [primaryKey({ columns: [t.assaultId, t.idx] })],
);

/** Journal des tirages (paquets, roue, upgrader, boss) : fil d'activité. Purgé au bout de 30 jours. */
export const pulls = pgTable(
  "pulls",
  {
    id: id(),
    userId: userRef("user_id").notNull(),
    cardId: bigint("card_id", { mode: "number" }).notNull(),
    season: smallint("season").notNull(),
    rarity: rarityEnum("rarity").notNull(),
    shiny: boolean("shiny").notNull().default(false),
    source: text("source", { enum: ["pack", "theme", "wheel", "upgrade", "boss"] }).notNull(),
    /** Genres « bizarres » repérés au tirage par les mots-clés du titre (les catégories sont lues à part). */
    genres: text("genres")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("pulls_created_idx").on(t.createdAt),
    index("pulls_card_idx").on(t.cardId),
    index("pulls_user_idx").on(t.userId, t.createdAt),
  ],
);

export const pullReactions = pgTable(
  "pull_reactions",
  {
    pullId: bigint("pull_id", { mode: "number" })
      .notNull()
      .references(() => pulls.id, { onDelete: "cascade" }),
    userId: userRef("user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pullId, t.userId, t.emoji] })],
);

/** Articles des catégories « bizarres » (genres du fil d'activité), rechargés en tâche de fond. */
export const weirdCards = pgTable(
  "weird_cards",
  {
    cardId: bigint("card_id", { mode: "number" }).notNull(),
    genre: text("genre").notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.genre] })],
);

/** Message serveur de l'admin : affiché par-dessus la page, en direct ou à la prochaine visite. */
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: id(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    tone: text("tone", { enum: ["info", "update", "event", "warning"] })
      .notNull()
      .default("info"),
    linkUrl: text("link_url"),
    linkLabel: text("link_label"),
    status: text("status", { enum: ["draft", "sent", "archived"] })
      .notNull()
      .default("draft"),
    /** Admin auteur (sans clé étrangère : le message survit au compte). */
    createdBy: text("created_by"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    sentAt: tstz("sent_at"),
    /** Après cette date, le message n'est plus montré aux retardataires. */
    expiresAt: tstz("expires_at"),
  },
  (t) => [index("broadcasts_status_idx").on(t.status, t.sentAt)],
);

export const broadcastReads = pgTable(
  "broadcast_reads",
  {
    broadcastId: bigint("broadcast_id", { mode: "number" })
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    userId: userRef("user_id").notNull(),
    readAt: tstz("read_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.broadcastId, t.userId] }), index("broadcast_reads_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Suggestions des joueurs
// ---------------------------------------------------------------------------

export const SUGGESTION_KINDS = ["bug", "feature", "content", "balance", "other"] as const;
export const SUGGESTION_STATUSES = ["new", "accepted", "done", "declined"] as const;

/** Suggestion envoyée à l'admin : bug à corriger, idée, contenu… Suivie par un statut et une réponse. */
export const suggestions = pgTable(
  "suggestions",
  {
    id: id(),
    userId: userRef("user_id").notNull(),
    kind: text("kind", { enum: SUGGESTION_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: SUGGESTION_STATUSES }).notNull().default("new"),
    /** Réponse de l'admin, visible par l'auteur. */
    reply: text("reply"),
    repliedAt: tstz("replied_at"),
    /** Première ouverture par un admin (null : pastille « nouvelle » du menu admin). */
    adminSeenAt: tstz("admin_seen_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("suggestions_user_idx").on(t.userId, t.createdAt),
    index("suggestions_status_idx").on(t.status, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Relations (requêtes relationnelles Drizzle)
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ one, many }) => ({
  player: one(players, { fields: [user.id], references: [players.userId] }),
  sessions: many(session),
  accounts: many(account),
}));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
