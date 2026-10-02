CREATE TABLE "boss_assaults" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "boss_assaults_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"day" date NOT NULL,
	"user_id" text NOT NULL,
	"number" smallint NOT NULL,
	"damage" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "boss_days" (
	"day" date PRIMARY KEY NOT NULL,
	"card_id" bigint NOT NULL,
	"season" smallint NOT NULL,
	"max_hp" integer NOT NULL,
	"hp" integer NOT NULL,
	"killed_at" timestamp with time zone,
	"killed_by" text,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "boss_days_hp_ok" CHECK ("boss_days"."hp" >= 0 AND "boss_days"."hp" <= "boss_days"."max_hp")
);
--> statement-breakpoint
CREATE TABLE "boss_hits" (
	"assault_id" bigint NOT NULL,
	"idx" smallint NOT NULL,
	"instance_id" bigint NOT NULL,
	"card_id" bigint NOT NULL,
	"season" smallint NOT NULL,
	"rarity" "rarity" NOT NULL,
	"atk" integer NOT NULL,
	"question" jsonb,
	"served_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"choice" smallint,
	"correct" boolean,
	"answer_ms" integer,
	"damage" integer,
	CONSTRAINT "boss_hits_assault_id_idx_pk" PRIMARY KEY("assault_id","idx")
);
--> statement-breakpoint
CREATE TABLE "broadcast_reads" (
	"broadcast_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_reads_broadcast_id_user_id_pk" PRIMARY KEY("broadcast_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "broadcasts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tone" text DEFAULT 'info' NOT NULL,
	"link_url" text,
	"link_label" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_articles" (
	"day" date PRIMARY KEY NOT NULL,
	"card_id" bigint NOT NULL,
	"season" smallint NOT NULL,
	"title" text NOT NULL,
	"rarity" "rarity" NOT NULL,
	"clues" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_guesses" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"guesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"found" boolean DEFAULT false NOT NULL,
	"reward" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "daily_guesses_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "player_quests" (
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"period_start" date NOT NULL,
	"slot" smallint NOT NULL,
	"tier" text NOT NULL,
	"kind" text NOT NULL,
	"target" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"reward_pw" integer NOT NULL,
	"reward_xp" integer NOT NULL,
	"rerolled" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "player_quests_user_id_period_period_start_slot_pk" PRIMARY KEY("user_id","period","period_start","slot"),
	CONSTRAINT "player_quests_target_ok" CHECK ("player_quests"."target" > 0 AND "player_quests"."progress" >= 0)
);
--> statement-breakpoint
CREATE TABLE "player_stats" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "player_stats_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "pull_reactions" (
	"pull_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pull_reactions_pull_id_user_id_emoji_pk" PRIMARY KEY("pull_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "pulls" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pulls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"card_id" bigint NOT NULL,
	"season" smallint NOT NULL,
	"rarity" "rarity" NOT NULL,
	"shiny" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weird_cards" (
	"card_id" bigint NOT NULL,
	"genre" text NOT NULL,
	CONSTRAINT "weird_cards_card_id_genre_pk" PRIMARY KEY("card_id","genre")
);
--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "shiny" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "card_instances" ADD COLUMN "shiny" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "season_xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "pass_season" smallint;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "pass_rewarded" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "stats_version" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "last_quest_reroll_day" date;--> statement-breakpoint
ALTER TABLE "boss_assaults" ADD CONSTRAINT "boss_assaults_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_days" ADD CONSTRAINT "boss_days_killed_by_user_id_fk" FOREIGN KEY ("killed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_hits" ADD CONSTRAINT "boss_hits_assault_id_boss_assaults_id_fk" FOREIGN KEY ("assault_id") REFERENCES "public"."boss_assaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_reads" ADD CONSTRAINT "broadcast_reads_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_reads" ADD CONSTRAINT "broadcast_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_guesses" ADD CONSTRAINT "daily_guesses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_quests" ADD CONSTRAINT "player_quests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_reactions" ADD CONSTRAINT "pull_reactions_pull_id_pulls_id_fk" FOREIGN KEY ("pull_id") REFERENCES "public"."pulls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_reactions" ADD CONSTRAINT "pull_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulls" ADD CONSTRAINT "pulls_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boss_assaults_day_user_uq" ON "boss_assaults" USING btree ("day","user_id","number");--> statement-breakpoint
CREATE INDEX "boss_assaults_day_idx" ON "boss_assaults" USING btree ("day");--> statement-breakpoint
CREATE INDEX "broadcast_reads_user_idx" ON "broadcast_reads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "broadcasts_status_idx" ON "broadcasts" USING btree ("status","sent_at");--> statement-breakpoint
CREATE INDEX "pulls_created_idx" ON "pulls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pulls_card_idx" ON "pulls" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "pulls_user_idx" ON "pulls" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_xp_ok" CHECK ("players"."season_xp" >= 0);