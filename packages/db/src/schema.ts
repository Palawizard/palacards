import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
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
    notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean>>().notNull().default({}),
    loginStreak: integer("login_streak").notNull().default(0),
    lastLoginDay: date("last_login_day"),
    lastSeenAt: tstz("last_seen_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("players_balance_ok", sql`${t.balance} >= ${t.lockedBalance} AND ${t.lockedBalance} >= 0`),
    check("players_packs_ok", sql`${t.packsStored} >= 0 AND ${t.bonusPacks} >= 0 AND ${t.pityCounter} >= 0`),
  ],
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
    favorite: boolean("favorite").notNull().default(false),
    /** Engagée dans une enchère ou un échange : ni recyclage, ni fusion, ni double vente. */
    lockedBy: text("locked_by", { enum: ["auction", "trade"] }),
    pinnedSlot: smallint("pinned_slot"),
    source: text("source", { enum: ["pack", "market", "trade", "admin"] }).notNull(),
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

/** Grand livre (ajout seulement) : points wiki (`pw`), paquets gratuits (`pack`), paquets bonus (`bonus_pack`) et cartes (`card`). */
export const ledger = pgTable(
  "ledger",
  {
    id: id(),
    userId: userRef("user_id").notNull(),
    kind: text("kind", { enum: ["pw", "bonus_pack", "pack", "card"] })
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
    mode: text("mode", { enum: ["live", "async"] }).notNull(),
    status: text("status", { enum: ["pending", "declined", "cancelled", "active", "finished"] })
      .notNull()
      .default("pending"),
    seed: text("seed").notNull(),
    winnerId: userRef("winner_id"),
    challengerScore: smallint("challenger_score").notNull().default(0),
    opponentScore: smallint("opponent_score").notNull().default(0),
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

/** Question d'une manche. La bonne réponse ne quitte jamais le serveur avant la réponse du joueur. */
export const battleRounds = pgTable(
  "battle_rounds",
  {
    battleId: bigint("battle_id", { mode: "number" })
      .notNull()
      .references(() => battles.id, { onDelete: "cascade" }),
    round: smallint("round").notNull(),
    question: jsonb("question").notNull(),
    winnerId: userRef("winner_id"),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.round] })],
);

export const battleAnswers = pgTable(
  "battle_answers",
  {
    battleId: bigint("battle_id", { mode: "number" })
      .notNull()
      .references(() => battles.id, { onDelete: "cascade" }),
    round: smallint("round").notNull(),
    userId: userRef("user_id").notNull(),
    servedAt: tstz("served_at").notNull(),
    answeredAt: tstz("answered_at"),
    choice: smallint("choice"),
    correct: boolean("correct"),
    timeLeftMs: integer("time_left_ms"),
    power: real("power"),
  },
  (t) => [
    primaryKey({ columns: [t.battleId, t.round, t.userId] }),
    // Questions en attente de réponse d'un joueur (catalogue coupé pendant une question).
    index("battle_answers_pending_idx")
      .on(t.userId, t.servedAt)
      .where(sql`${t.answeredAt} IS NULL`),
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
