"""Création du booster en prod en une transaction : thème, cartes avec rareté et rang, index de tirage.

Même résultat que `createTheme` + `indexTheme` de l'API (`apps/api/src/services/themes.ts`), mais en SQL
direct : la rareté et le rang par rareté sont écrits dès l'insertion (150 000 cartes en quelques secondes,
contre plus de 11 min pour `theme.js` le 2026-11-03).
"""

from __future__ import annotations

from .spec import Spec

PREVIEW_SIZE = 4  # comme PREVIEW_SIZE dans themes.ts


def _lit(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def script(spec: Spec, ids: list[int], season: int, price: int, by: str, commit: bool) -> str:
    data = "\n".join(str(i) for i in sorted(ids))
    return f"""
\\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF (SELECT id FROM seasons WHERE status = 'active') <> {season} THEN
    RAISE EXCEPTION 'La saison active n''est plus la {season} : refais l''index.';
  END IF;
END $$;
CREATE TEMP TABLE _ids (id bigint PRIMARY KEY) ON COMMIT DROP;
COPY _ids FROM STDIN;
{data}
\\.
INSERT INTO themes (name, description, category, price, starts_at, ends_at, created_by)
VALUES ({_lit(spec.name)}, {_lit(spec.description)}, {_lit(spec.display_category)}, {price},
        {_lit(spec.starts.isoformat())}, {_lit(spec.ends.isoformat())},
        (SELECT id FROM "user" WHERE username = {_lit(by)}))
RETURNING id AS theme_id \\gset
INSERT INTO theme_cards (theme_id, card_id, rarity, pos)
SELECT :theme_id, c.id, c.rarity,
       (row_number() OVER (PARTITION BY c.rarity ORDER BY c.id) - 1)::int
FROM cards c JOIN _ids i ON i.id = c.id WHERE c.season = {season};
UPDATE themes SET
  card_count = (SELECT count(*) FROM theme_cards WHERE theme_id = themes.id),
  by_rarity = (SELECT jsonb_object_agg(r::text, coalesce(n, 0)) FROM unnest(enum_range(NULL::rarity)) r
               LEFT JOIN (SELECT rarity, count(*)::int n FROM theme_cards WHERE theme_id = themes.id
                          GROUP BY rarity) x ON x.rarity = r),
  preview_ids = (SELECT jsonb_agg(id) FROM (
                   SELECT c.id FROM theme_cards tc JOIN cards c ON c.season = {season} AND c.id = tc.card_id
                   WHERE tc.theme_id = themes.id ORDER BY c.rarity DESC, c.views_12m DESC LIMIT {PREVIEW_SIZE}) p),
  indexed_season = {season}
WHERE id = :theme_id;
SELECT 'theme', id, card_count, by_rarity, created_by IS NOT NULL FROM themes WHERE id = :theme_id;
{"COMMIT;" if commit else "ROLLBACK;"}
{"ANALYZE theme_cards;" if commit else ""}
"""
