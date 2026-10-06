ALTER TABLE "player_theme_packs" ADD COLUMN "opened" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_theme_packs" ADD CONSTRAINT "player_theme_packs_opened_ok" CHECK ("player_theme_packs"."opened" >= 0);--> statement-breakpoint
-- Boosters à thème déjà ouverts, retrouvés dans le ledger : sortie du stock à l'ouverture (`pack_open`) ou achat
-- au moment d'ouvrir (PW, `theme_pack`). Les deux portent la référence `theme:<id>`.
INSERT INTO "player_theme_packs" ("user_id", "theme_id", "count", "opened")
SELECT l."user_id", substring(l."ref_id" from 7)::bigint, 0, count(*)::int
FROM "ledger" l
WHERE l."delta" < 0
  AND ((l."kind" = 'theme_pack' AND l."reason" = 'pack_open') OR (l."kind" = 'pw' AND l."reason" = 'theme_pack'))
  AND l."ref_id" ~ '^theme:[0-9]+$'
  AND EXISTS (SELECT 1 FROM "themes" t WHERE t."id" = substring(l."ref_id" from 7)::bigint)
  AND EXISTS (SELECT 1 FROM "user" u WHERE u."id" = l."user_id")
GROUP BY l."user_id", substring(l."ref_id" from 7)::bigint
ON CONFLICT ("user_id", "theme_id") DO UPDATE SET "opened" = excluded."opened";
