-- Exécuté une seule fois à la création du volume Postgres.
-- Extensions nécessaires à la recherche floue du catalogue « Toutes les cartes ».
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- Statistiques des requêtes (bibliothèque chargée par shared_preload_libraries, docker-compose.yml).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
