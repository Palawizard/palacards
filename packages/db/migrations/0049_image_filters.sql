CREATE TABLE "image_filter_cards" (
	"card_id" bigint NOT NULL,
	"theme" text NOT NULL,
	CONSTRAINT "image_filter_cards_card_id_theme_pk" PRIMARY KEY("card_id","theme")
);
--> statement-breakpoint
CREATE TABLE "image_filter_overrides" (
	"card_id" bigint NOT NULL,
	"theme" text NOT NULL,
	"flagged" boolean NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_filter_overrides_card_id_theme_pk" PRIMARY KEY("card_id","theme")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "hide_gore" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "hide_nudity" boolean DEFAULT false NOT NULL;