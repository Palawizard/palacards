CREATE TABLE "player_avatars" (
	"user_id" text PRIMARY KEY NOT NULL,
	"image" "bytea" NOT NULL,
	"mime" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_avatars_size_ok" CHECK (octet_length("player_avatars"."image") <= 150000)
);
--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;