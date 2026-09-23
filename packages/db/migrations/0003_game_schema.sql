CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achievements_progress" (
	"user_id" text NOT NULL,
	"achievement_key" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"unlocked_at" timestamp with time zone,
	CONSTRAINT "achievements_progress_user_id_achievement_key_pk" PRIMARY KEY("user_id","achievement_key")
);
--> statement-breakpoint
CREATE TABLE "auctions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auctions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"instance_id" bigint NOT NULL,
	"seller_id" text NOT NULL,
	"card_id" bigint NOT NULL,
	"season" smallint NOT NULL,
	"rarity" "rarity" NOT NULL,
	"start_price" integer NOT NULL,
	"buyout" integer,
	"current_bid" integer,
	"current_bidder_id" text,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "auctions_prices_ok" CHECK ("auctions"."start_price" > 0 AND ("auctions"."buyout" IS NULL OR "auctions"."buyout" >= "auctions"."start_price"))
);
--> statement-breakpoint
CREATE TABLE "battle_answers" (
	"battle_id" bigint NOT NULL,
	"round" smallint NOT NULL,
	"user_id" text NOT NULL,
	"served_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"choice" smallint,
	"correct" boolean,
	"time_left_ms" integer,
	"power" real,
	CONSTRAINT "battle_answers_battle_id_round_user_id_pk" PRIMARY KEY("battle_id","round","user_id")
);
--> statement-breakpoint
CREATE TABLE "battle_decks" (
	"battle_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"slot" smallint NOT NULL,
	"instance_id" bigint NOT NULL,
	"card_id" bigint NOT NULL,
	"season" smallint NOT NULL,
	"rarity" "rarity" NOT NULL,
	"atk" integer NOT NULL,
	"def" integer NOT NULL,
	CONSTRAINT "battle_decks_battle_id_user_id_slot_pk" PRIMARY KEY("battle_id","user_id","slot"),
	CONSTRAINT "battle_decks_slot" CHECK ("battle_decks"."slot" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "battle_rounds" (
	"battle_id" bigint NOT NULL,
	"round" smallint NOT NULL,
	"question" jsonb NOT NULL,
	"winner_id" text,
	CONSTRAINT "battle_rounds_battle_id_round_pk" PRIMARY KEY("battle_id","round")
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "battles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"challenger_id" text NOT NULL,
	"opponent_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"seed" text NOT NULL,
	"winner_id" text,
	"challenger_score" smallint DEFAULT 0 NOT NULL,
	"opponent_score" smallint DEFAULT 0 NOT NULL,
	"challenger_elo_delta" integer,
	"opponent_elo_delta" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "battles_distinct" CHECK ("battles"."challenger_id" <> "battles"."opponent_id")
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bids_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"auction_id" bigint NOT NULL,
	"bidder_id" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bids_amount_ok" CHECK ("bids"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "card_instances" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "card_instances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"owner_id" text NOT NULL,
	"card_id" bigint NOT NULL,
	"season" smallint NOT NULL,
	"rarity" "rarity" NOT NULL,
	"atk" smallint NOT NULL,
	"def" smallint NOT NULL,
	"level" smallint DEFAULT 1 NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"locked_by" text,
	"pinned_slot" smallint,
	"source" text NOT NULL,
	"obtained_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_instances_level_ok" CHECK ("card_instances"."level" BETWEEN 1 AND 5),
	CONSTRAINT "card_instances_pinned_ok" CHECK ("card_instances"."pinned_slot" IS NULL OR "card_instances"."pinned_slot" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_user_a_user_b_pk" PRIMARY KEY("user_a","user_b"),
	CONSTRAINT "friendships_order" CHECK ("friendships"."user_a" < "friendships"."user_b")
);
--> statement-breakpoint
CREATE TABLE "guild_members" (
	"user_id" text PRIMARY KEY NOT NULL,
	"guild_id" bigint NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_objectives" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "guild_objectives_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"guild_id" bigint NOT NULL,
	"week_start" date NOT NULL,
	"kind" text NOT NULL,
	"target" integer NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "guilds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"tag" text NOT NULL,
	"emblem" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'pw' NOT NULL,
	"delta" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reason" text NOT NULL,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_delta_nonzero" CHECK ("ledger"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "message_reads" (
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_reads_user_id_channel_pk" PRIMARY KEY("user_id","channel")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"sender_id" text NOT NULL,
	"body" text NOT NULL,
	"card_id" bigint,
	"card_season" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_body_len" CHECK (char_length("messages"."body") BETWEEN 0 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"locked_balance" bigint DEFAULT 0 NOT NULL,
	"packs_stored" smallint DEFAULT 10 NOT NULL,
	"packs_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bonus_packs" integer DEFAULT 0 NOT NULL,
	"pity_counter" integer DEFAULT 0 NOT NULL,
	"elo" integer DEFAULT 1000 NOT NULL,
	"elo_peak" integer DEFAULT 1000 NOT NULL,
	"avatar" text,
	"animation_speed" text DEFAULT 'normal' NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"login_streak" integer DEFAULT 0 NOT NULL,
	"last_login_day" date,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_balance_ok" CHECK ("players"."balance" >= "players"."locked_balance" AND "players"."locked_balance" >= 0),
	CONSTRAINT "players_packs_ok" CHECK ("players"."packs_stored" >= 0 AND "players"."bonus_packs" >= 0 AND "players"."pity_counter" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"card_id" bigint NOT NULL,
	"rarity" "rarity" NOT NULL,
	"price" integer NOT NULL,
	"auction_id" bigint,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_archives" (
	"season" smallint NOT NULL,
	"user_id" text NOT NULL,
	"collection_score" integer NOT NULL,
	"elo" integer NOT NULL,
	"wealth" bigint NOT NULL,
	"guild_id" bigint,
	CONSTRAINT "season_archives_season_user_id_pk" PRIMARY KEY("season","user_id")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" smallint PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "trade_items" (
	"trade_id" bigint NOT NULL,
	"instance_id" bigint NOT NULL,
	"side" text NOT NULL,
	CONSTRAINT "trade_items_trade_id_instance_id_pk" PRIMARY KEY("trade_id","instance_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"from_pw" integer DEFAULT 0 NOT NULL,
	"to_pw" integer DEFAULT 0 NOT NULL,
	"message" text,
	"parent_id" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "trades_pw_ok" CHECK ("trades"."from_pw" >= 0 AND "trades"."to_pw" >= 0),
	CONSTRAINT "trades_distinct" CHECK ("trades"."from_id" <> "trades"."to_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"username" text,
	"display_username" text,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "user_tags" (
	"instance_id" bigint NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "user_tags_instance_id_tag_pk" PRIMARY KEY("instance_id","tag"),
	CONSTRAINT "user_tags_len" CHECK (char_length("user_tags"."tag") BETWEEN 1 AND 24)
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_summaries" (
	"page_id" bigint PRIMARY KEY NOT NULL,
	"extract" text,
	"thumb_url" text,
	"page_url" text,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist" (
	"user_id" text NOT NULL,
	"card_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_user_id_card_id_pk" PRIMARY KEY("user_id","card_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements_progress" ADD CONSTRAINT "achievements_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_instance_id_card_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."card_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_seller_id_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_current_bidder_id_user_id_fk" FOREIGN KEY ("current_bidder_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_answers" ADD CONSTRAINT "battle_answers_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_answers" ADD CONSTRAINT "battle_answers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_decks" ADD CONSTRAINT "battle_decks_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_decks" ADD CONSTRAINT "battle_decks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_winner_id_user_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_challenger_id_user_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_opponent_id_user_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_winner_id_user_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_user_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_instances" ADD CONSTRAINT "card_instances_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_instances" ADD CONSTRAINT "card_instances_season_card_id_cards_season_id_fk" FOREIGN KEY ("season","card_id") REFERENCES "public"."cards"("season","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_user_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_user_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_objectives" ADD CONSTRAINT "guild_objectives_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_archives" ADD CONSTRAINT "season_archives_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_instance_id_card_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."card_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_from_id_user_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_to_id_user_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tags" ADD CONSTRAINT "user_tags_instance_id_card_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."card_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auctions_status_ends_idx" ON "auctions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_open_instance_uq" ON "auctions" USING btree ("instance_id") WHERE "auctions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "battles_challenger_idx" ON "battles" USING btree ("challenger_id","created_at");--> statement-breakpoint
CREATE INDEX "battles_opponent_idx" ON "battles" USING btree ("opponent_id","created_at");--> statement-breakpoint
CREATE INDEX "bids_auction_idx" ON "bids" USING btree ("auction_id","created_at");--> statement-breakpoint
CREATE INDEX "card_instances_owner_card_idx" ON "card_instances" USING btree ("owner_id","card_id");--> statement-breakpoint
CREATE INDEX "card_instances_owner_obtained_idx" ON "card_instances" USING btree ("owner_id","obtained_at");--> statement-breakpoint
CREATE UNIQUE INDEX "card_instances_pinned_uq" ON "card_instances" USING btree ("owner_id","pinned_slot") WHERE "card_instances"."pinned_slot" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "friendships_b_idx" ON "friendships" USING btree ("user_b");--> statement-breakpoint
CREATE INDEX "guild_members_guild_idx" ON "guild_members" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guild_objectives_week_uq" ON "guild_objectives" USING btree ("guild_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "guilds_name_uq" ON "guilds" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "guilds_tag_uq" ON "guilds" USING btree (lower("tag"));--> statement-breakpoint
CREATE INDEX "ledger_user_created_idx" ON "ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_channel_idx" ON "messages" USING btree ("channel","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_card_sold_idx" ON "sales" USING btree ("card_id","sold_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_one_active" ON "seasons" USING btree ("status") WHERE "seasons"."status" = 'active';--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trades_to_idx" ON "trades" USING btree ("to_id","status");--> statement-breakpoint
CREATE INDEX "trades_from_idx" ON "trades" USING btree ("from_id","status");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "wishlist_card_idx" ON "wishlist" USING btree ("card_id");