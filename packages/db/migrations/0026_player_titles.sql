CREATE TABLE "player_titles" (
	"user_id" text NOT NULL,
	"season" smallint NOT NULL,
	"board" text NOT NULL,
	"rank" smallint NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_titles_user_id_season_board_pk" PRIMARY KEY("user_id","season","board")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "title_season" smallint;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "title_board" text;--> statement-breakpoint
ALTER TABLE "player_titles" ADD CONSTRAINT "player_titles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;