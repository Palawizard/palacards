CREATE TABLE "boss_phases" (
	"day" date NOT NULL,
	"phase" smallint NOT NULL,
	"max_hp" integer NOT NULL,
	"fallen_at" timestamp with time zone NOT NULL,
	"fallen_by" text,
	CONSTRAINT "boss_phases_day_phase_pk" PRIMARY KEY("day","phase")
);
--> statement-breakpoint
CREATE TABLE "boss_question_history" (
	"user_id" text NOT NULL,
	"card_id" bigint NOT NULL,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boss_question_history_user_id_card_id_type_key_pk" PRIMARY KEY("user_id","card_id","type","key")
);
--> statement-breakpoint
CREATE TABLE "wiki_attributes" (
	"page_id" bigint PRIMARY KEY NOT NULL,
	"qid" text,
	"human" boolean,
	"country_id" text,
	"country" text,
	"continents" text[] DEFAULT '{}'::text[] NOT NULL,
	"year" smallint,
	"year_kind" text,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boss_days" DROP CONSTRAINT "boss_days_hp_ok";--> statement-breakpoint
ALTER TABLE "boss_days" ADD COLUMN "version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "boss_days" ADD COLUMN "phase" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "boss_days" ADD COLUMN "damage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boss_days" ADD COLUMN "weakness" text;--> statement-breakpoint
ALTER TABLE "boss_days" ADD COLUMN "resistance" text;--> statement-breakpoint
ALTER TABLE "boss_hits" ADD COLUMN "guess_year" smallint;--> statement-breakpoint
ALTER TABLE "boss_hits" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "boss_hits" ADD COLUMN "mult" double precision;--> statement-breakpoint
ALTER TABLE "boss_rewards" ADD COLUMN "phases" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_articles" ADD COLUMN "format" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_articles" ADD COLUMN "attrs" jsonb;--> statement-breakpoint
ALTER TABLE "daily_articles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "daily_articles" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "daily_guesses" ADD COLUMN "entries" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "boss_phases" ADD CONSTRAINT "boss_phases_fallen_by_user_id_fk" FOREIGN KEY ("fallen_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_question_history" ADD CONSTRAINT "boss_question_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_days" ADD CONSTRAINT "boss_days_state_ok" CHECK ("boss_days"."hp" >= 0 AND "boss_days"."damage" >= 0 AND "boss_days"."phase" >= 1);