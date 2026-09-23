-- Étape 5 (sur vm-apps) : charge cards.csv.gz dans cards_next, contrôle les effectifs par rareté
-- et insère les cartes de la saison demandée dans cards, le tout en une seule transaction
-- (fonction finish_card_load, migration 0002). La saison reste inactive jusqu'à sa bascule par le jeu.
--
-- Usage : gunzip -c cards.csv.gz | psql "$DATABASE_URL" -v season=2 -f load_cards.sql
\set ON_ERROR_STOP on
BEGIN;
TRUNCATE cards_next;
\copy cards_next (id, title, rarity, atk, def, views_12m, page_len) FROM pstdin WITH (FORMAT csv, HEADER true)
SELECT * FROM finish_card_load(:season::smallint);
COMMIT;
ANALYZE cards;
