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
-- Tout premier chargement : la saison est activée tout de suite (fin au 1er du mois suivant, heure de Paris).
-- Les suivantes basculent le 1er du mois ou depuis l'Admin. En restauration, les saisons viennent du dump.
\if :{?restore}
\else
INSERT INTO seasons (id, status, started_at, ends_at)
SELECT :season, 'active', now(),
       (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') + interval '1 month') AT TIME ZONE 'Europe/Paris'
WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE status = 'active');
\endif
COMMIT;
ANALYZE cards;
