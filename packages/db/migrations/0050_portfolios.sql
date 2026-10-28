CREATE TABLE "player_portfolio_designs" (
	"user_id" text NOT NULL,
	"design_key" text NOT NULL,
	"source" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_portfolio_designs_user_id_design_key_pk" PRIMARY KEY("user_id","design_key")
);
--> statement-breakpoint
CREATE TABLE "portfolio_backgrounds" (
	"portfolio_id" bigint PRIMARY KEY NOT NULL,
	"image" "bytea" NOT NULL,
	"mime" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_backgrounds_size_ok" CHECK (octet_length("portfolio_backgrounds"."image") <= 180000)
);
--> statement-breakpoint
CREATE TABLE "portfolio_cards" (
	"portfolio_id" bigint NOT NULL,
	"instance_id" bigint NOT NULL,
	"pos" smallint NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	CONSTRAINT "portfolio_cards_portfolio_id_instance_id_pk" PRIMARY KEY("portfolio_id","instance_id"),
	CONSTRAINT "portfolio_cards_pos_ok" CHECK ("portfolio_cards"."pos" BETWEEN 0 AND 29)
);
--> statement-breakpoint
CREATE TABLE "portfolio_likes" (
	"portfolio_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_likes_portfolio_id_user_id_pk" PRIMARY KEY("portfolio_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "portfolios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"background" text DEFAULT 'papier' NOT NULL,
	"frame" text DEFAULT 'filet' NOT NULL,
	"accent" text DEFAULT 'or' NOT NULL,
	"profile_slot" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolios_name_len" CHECK (char_length("portfolios"."name") BETWEEN 1 AND 40),
	CONSTRAINT "portfolios_description_len" CHECK (char_length("portfolios"."description") <= 280),
	CONSTRAINT "portfolios_profile_ok" CHECK ("portfolios"."profile_slot" IS NULL OR "portfolios"."profile_slot" BETWEEN 1 AND 3)
);
--> statement-breakpoint
ALTER TABLE "player_portfolio_designs" ADD CONSTRAINT "player_portfolio_designs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_backgrounds" ADD CONSTRAINT "portfolio_backgrounds_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_cards" ADD CONSTRAINT "portfolio_cards_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_cards" ADD CONSTRAINT "portfolio_cards_instance_id_card_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."card_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_likes" ADD CONSTRAINT "portfolio_likes_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_likes" ADD CONSTRAINT "portfolio_likes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_cards_instance_idx" ON "portfolio_cards" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "portfolio_likes_user_idx" ON "portfolio_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portfolios_user_idx" ON "portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portfolios_created_idx" ON "portfolios" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolios_profile_uq" ON "portfolios" USING btree ("user_id","profile_slot") WHERE "portfolios"."profile_slot" IS NOT NULL;