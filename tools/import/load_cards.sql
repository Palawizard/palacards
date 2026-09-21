-- Étape 5 (sur vm-apps) : charge cards.csv.gz dans une table temporaire puis bascule.
-- Usage : gunzip -c cards.csv.gz | psql "$DATABASE_URL" -v season=1 -f load_cards.sql
BEGIN;
CREATE TABLE IF NOT EXISTS cards_next (LIKE cards INCLUDING DEFAULTS);
TRUNCATE cards_next;
\copy cards_next (id, season, title, rarity, atk, def, views_12m, page_len) FROM pstdin WITH (FORMAT csv, HEADER true)
-- TODO phase 0 : contrôles (comptes par rareté), puis insertion dans cards pour la nouvelle saison.
COMMIT;
