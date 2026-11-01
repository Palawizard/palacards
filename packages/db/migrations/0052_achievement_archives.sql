CREATE TABLE "achievement_archives" (
	"season" smallint NOT NULL,
	"user_id" text NOT NULL,
	"achievement_key" text NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "achievement_archives_season_user_id_achievement_key_pk" PRIMARY KEY("season","user_id","achievement_key")
);
--> statement-breakpoint
ALTER TABLE "achievement_archives" ADD CONSTRAINT "achievement_archives_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievement_archives_user_idx" ON "achievement_archives" USING btree ("user_id");