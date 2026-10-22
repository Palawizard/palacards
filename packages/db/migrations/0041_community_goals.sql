CREATE TABLE "community_goal_rewards" (
	"season" smallint NOT NULL,
	"tier" smallint NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_goal_rewards_season_tier_user_id_pk" PRIMARY KEY("season","tier","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_goals" (
	"season" smallint PRIMARY KEY NOT NULL,
	"distinct_cards" integer DEFAULT 0 NOT NULL,
	"season_cards" integer DEFAULT 0 NOT NULL,
	"tiers_reached" smallint DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_goal_rewards" ADD CONSTRAINT "community_goal_rewards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pulls_season_card_idx" ON "pulls" USING btree ("season","card_id");