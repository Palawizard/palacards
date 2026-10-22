ALTER TABLE "players" ADD COLUMN "packs_full_notified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Stock déjà plein (10 min par paquet, 30 au maximum) : la notification de ce remplissage est déjà partie.
UPDATE "players" SET "packs_full_notified" = true
WHERE "packs_stored" + floor(extract(epoch from (now() - "packs_updated_at")) / 600) >= 30;--> statement-breakpoint
-- Doublons « stock plein » non lus (suggestion n° 106) : on garde la plus récente par joueur.
DELETE FROM "notifications" n
WHERE n."type" = 'packs_full' AND n."read_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "notifications" m
    WHERE m."user_id" = n."user_id" AND m."type" = 'packs_full' AND m."read_at" IS NULL AND m."id" > n."id"
  );
