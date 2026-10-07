CREATE TABLE "battle_queue" (
	"user_id" text PRIMARY KEY NOT NULL,
	"deck" bigint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "battle_queue" ADD CONSTRAINT "battle_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;