ALTER TABLE "players" ADD COLUMN "wheel_step" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "wheel_last_at" timestamp with time zone;--> statement-breakpoint
-- Joueurs qui ont déjà tourné l'ancienne roue unique aujourd'hui : elle compte comme la petite roue, la
-- moyenne s'ouvre 2 h 30 après la mise en production.
UPDATE "players" SET "wheel_step" = 1, "wheel_last_at" = now()
WHERE "last_wheel_day" = (now() AT TIME ZONE 'Europe/Paris')::date;
