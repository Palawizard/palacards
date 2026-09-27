CREATE TABLE "player_theme_packs" (
	"user_id" text NOT NULL,
	"theme_id" bigint NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "player_theme_packs_user_id_theme_id_pk" PRIMARY KEY("user_id","theme_id"),
	CONSTRAINT "player_theme_packs_count_ok" CHECK ("player_theme_packs"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"pw" integer DEFAULT 0 NOT NULL,
	"packs" integer DEFAULT 0 NOT NULL,
	"theme_id" bigint,
	"theme_packs" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_amounts_ok" CHECK ("promo_codes"."pw" >= 0 AND "promo_codes"."packs" >= 0 AND "promo_codes"."theme_packs" >= 0),
	CONSTRAINT "promo_codes_uses_ok" CHECK ("promo_codes"."uses" >= 0 AND ("promo_codes"."max_uses" IS NULL OR "promo_codes"."uses" <= "promo_codes"."max_uses")),
	CONSTRAINT "promo_codes_code_ok" CHECK ("promo_codes"."code" ~ '^[A-Z0-9_-]{3,32}$')
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"code" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_redemptions_code_user_id_pk" PRIMARY KEY("code","user_id")
);
--> statement-breakpoint
CREATE TABLE "theme_cards" (
	"theme_id" bigint NOT NULL,
	"card_id" bigint NOT NULL,
	CONSTRAINT "theme_cards_theme_id_card_id_pk" PRIMARY KEY("theme_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "themes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"price" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"card_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "themes_price_ok" CHECK ("themes"."price" > 0),
	CONSTRAINT "themes_dates_ok" CHECK ("themes"."ends_at" > "themes"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "last_wheel_day" date;--> statement-breakpoint
ALTER TABLE "player_theme_packs" ADD CONSTRAINT "player_theme_packs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_theme_packs" ADD CONSTRAINT "player_theme_packs_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_code_promo_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."promo_codes"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_cards" ADD CONSTRAINT "theme_cards_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_theme_packs_theme_idx" ON "player_theme_packs" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "promo_redemptions_user_idx" ON "promo_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "themes_ends_idx" ON "themes" USING btree ("ends_at");