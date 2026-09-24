ALTER TABLE "cards" ADD COLUMN "search_title" text GENERATED ALWAYS AS (lower(f_unaccent(title))) STORED;--> statement-breakpoint
CREATE INDEX "cards_search_trgm_idx" ON "cards" USING gin ("search_title" gin_trgm_ops);--> statement-breakpoint
-- Remplacé par l'index sur la colonne stockée search_title.
DROP INDEX IF EXISTS "cards_title_trgm_idx";
