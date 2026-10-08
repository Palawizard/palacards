CREATE TABLE "guild_objective_contributions" (
	"objective_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guild_objective_contributions_objective_id_user_id_pk" PRIMARY KEY("objective_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "guild_objective_contributions" ADD CONSTRAINT "guild_objective_contributions_objective_id_guild_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."guild_objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_objective_contributions" ADD CONSTRAINT "guild_objective_contributions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;