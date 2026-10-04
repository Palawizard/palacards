CREATE TABLE "boss_rewards" (
	"day" date NOT NULL,
	"user_id" text NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boss_rewards_day_user_id_pk" PRIMARY KEY("day","user_id")
);
--> statement-breakpoint
ALTER TABLE "boss_rewards" ADD CONSTRAINT "boss_rewards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Boss déjà tombés et pas encore clos : leurs participants ont été payés à la chute (meilleur assaillant
-- compris, ancienne règle). On les inscrit, et la journée est close pour ne rien repayer à minuit.
INSERT INTO "boss_rewards" ("day", "user_id", "paid_at")
SELECT DISTINCT a."day", a."user_id", d."killed_at"
FROM "boss_assaults" a
JOIN "boss_days" d ON d."day" = a."day"
WHERE d."killed_at" IS NOT NULL AND d."finalized_at" IS NULL AND a."started_at" <= d."killed_at"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "boss_days" SET "finalized_at" = now() WHERE "killed_at" IS NOT NULL AND "finalized_at" IS NULL;
