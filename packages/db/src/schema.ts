import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const rarityEnum = pgEnum("rarity", ["C", "PC", "R", "SR", "UR", "L"]);

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
    randKey: real("rand_key")
      .notNull()
      .default(sql`random()`),
    thumbUrl: text("thumb_url"),
    extract: text("extract"),
    summaryFetchedAt: timestamp("summary_fetched_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.season, t.id] }), index("cards_rarity_rand_idx").on(t.season, t.rarity, t.randKey)],
);

// Les autres tables (users, card_instances, ledger, auctions, ...) arrivent en phase 1+.
// Voir docs/ pour le schéma complet.
