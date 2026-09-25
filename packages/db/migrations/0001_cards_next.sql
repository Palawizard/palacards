CREATE TABLE "cards_next" (
	"id" bigint NOT NULL,
	"title" text NOT NULL,
	"rarity" "rarity" NOT NULL,
	"atk" smallint NOT NULL,
	"def" smallint NOT NULL,
	"views_12m" bigint NOT NULL,
	"page_len" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "thumb_url";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "extract";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "summary_fetched_at";