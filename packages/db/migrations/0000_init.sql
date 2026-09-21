CREATE TYPE "public"."rarity" AS ENUM('C', 'PC', 'R', 'SR', 'UR', 'L');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" bigint NOT NULL,
	"season" smallint NOT NULL,
	"title" text NOT NULL,
	"rarity" "rarity" NOT NULL,
	"atk" smallint NOT NULL,
	"def" smallint NOT NULL,
	"views_12m" bigint NOT NULL,
	"page_len" integer NOT NULL,
	"rand_key" real DEFAULT random() NOT NULL,
	"thumb_url" text,
	"extract" text,
	"summary_fetched_at" timestamp with time zone,
	CONSTRAINT "cards_season_id_pk" PRIMARY KEY("season","id")
);
--> statement-breakpoint
CREATE INDEX "cards_rarity_rand_idx" ON "cards" USING btree ("season","rarity","rand_key");