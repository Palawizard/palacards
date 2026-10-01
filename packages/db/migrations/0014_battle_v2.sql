-- Nouveau duel « Attaque / Bouclier » (en direct uniquement) : les duels de l'ancien format encore
-- en attente ou en cours sont annulés (sans récompense) ; l'historique des duels terminés est gardé.
UPDATE "battles" SET "status" = 'cancelled', "finished_at" = now() WHERE "status" IN ('pending', 'active');--> statement-breakpoint
DROP TABLE "battle_answers" CASCADE;--> statement-breakpoint
DROP TABLE "battle_rounds" CASCADE;--> statement-breakpoint
ALTER TABLE "battles" DROP COLUMN "mode";--> statement-breakpoint
ALTER TABLE "battles" DROP COLUMN "challenger_score";--> statement-breakpoint
ALTER TABLE "battles" DROP COLUMN "opponent_score";--> statement-breakpoint
CREATE TABLE "battle_turns" (
	"battle_id" bigint NOT NULL,
	"turn" smallint NOT NULL,
	"attacker_id" text NOT NULL,
	"defender_id" text NOT NULL,
	"attack_slot" smallint NOT NULL,
	"attack_auto" boolean DEFAULT false NOT NULL,
	"shield_slot" smallint,
	"shield_auto" boolean DEFAULT false NOT NULL,
	"question" jsonb,
	"served_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"choice" smallint,
	"correct" boolean,
	"answer_ms" integer,
	"raw_damage" smallint,
	"shield_pct" smallint,
	"damage" smallint,
	"reflected" smallint,
	CONSTRAINT "battle_turns_battle_id_turn_pk" PRIMARY KEY("battle_id","turn"),
	CONSTRAINT "battle_turns_turn" CHECK ("battle_turns"."turn" BETWEEN 1 AND 8)
);
--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "turn" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "phase_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "phase_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "first_attacker_id" text;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "challenger_hp" smallint;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "opponent_hp" smallint;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "challenger_idle" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "opponent_idle" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "forfeit_by" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "seen_features" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_summaries" ADD COLUMN "description" text;--> statement-breakpoint
-- Résumés déjà en cache : sans description (version 1), rechargés à la demande par les duels.
ALTER TABLE "wiki_summaries" ADD COLUMN "version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_summaries" ALTER COLUMN "version" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "battle_turns" ADD CONSTRAINT "battle_turns_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_turns" ADD CONSTRAINT "battle_turns_attacker_id_user_id_fk" FOREIGN KEY ("attacker_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_turns" ADD CONSTRAINT "battle_turns_defender_id_user_id_fk" FOREIGN KEY ("defender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "battle_turns_defender_idx" ON "battle_turns" USING btree ("defender_id");--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_first_attacker_id_user_id_fk" FOREIGN KEY ("first_attacker_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_forfeit_by_user_id_fk" FOREIGN KEY ("forfeit_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;