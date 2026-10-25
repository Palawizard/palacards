ALTER TABLE "theme_cards" ADD COLUMN "rarity" "rarity";--> statement-breakpoint
ALTER TABLE "theme_cards" ADD COLUMN "pos" integer;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "indexed_season" smallint;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "by_rarity" jsonb;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "preview_ids" jsonb;--> statement-breakpoint
CREATE INDEX "theme_cards_draw_idx" ON "theme_cards" USING btree ("theme_id","rarity","pos");--> statement-breakpoint
-- Remplissage pour la saison active (même calcul que indexTheme dans apps/api/src/services/themes.ts).
WITH s AS (SELECT id FROM seasons WHERE status = 'active' LIMIT 1),
ranked AS (
  SELECT tc.theme_id, tc.card_id, c.rarity,
    (row_number() OVER (PARTITION BY tc.theme_id, c.rarity ORDER BY tc.card_id) - 1)::int AS pos
  FROM theme_cards tc JOIN cards c ON c.season = (SELECT id FROM s) AND c.id = tc.card_id
)
UPDATE theme_cards tc SET rarity = r.rarity, pos = r.pos
FROM ranked r WHERE tc.theme_id = r.theme_id AND tc.card_id = r.card_id;--> statement-breakpoint
WITH s AS (SELECT id FROM seasons WHERE status = 'active' LIMIT 1)
UPDATE themes t SET
  indexed_season = (SELECT id FROM s),
  by_rarity = coalesce((
    SELECT jsonb_object_agg(x.rarity::text, x.n) FROM (
      SELECT tc.rarity, count(*)::int AS n FROM theme_cards tc
      WHERE tc.theme_id = t.id AND tc.rarity IS NOT NULL GROUP BY tc.rarity
    ) x), '{}'::jsonb),
  preview_ids = coalesce((
    SELECT jsonb_agg(p.id ORDER BY p.ord) FROM (
      SELECT c.id, row_number() OVER (ORDER BY c.rarity DESC, c.views_12m DESC) AS ord
      FROM theme_cards tc JOIN cards c ON c.season = (SELECT id FROM s) AND c.id = tc.card_id
      WHERE tc.theme_id = t.id
      ORDER BY c.rarity DESC, c.views_12m DESC
      LIMIT 4
    ) p), '[]'::jsonb)
WHERE EXISTS (SELECT 1 FROM s);
