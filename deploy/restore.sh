#!/bin/sh
# Restauration d'une sauvegarde PalaCards (voir docs/14-exploitation.md).
# Usage : ./restore.sh /mnt/nas/backups/palacards/palacards_2026-10-01_0400.dump <saison active>
# Le dossier du dump doit contenir cards-s<N>.csv.gz (CSV d'import de la saison active, ou de la
# dernière saison importée avant elle si elle a été reconduite) et palacards_<date>.cards-ref.csv.gz.
# 1. base recréée, schéma complet (tables vides, index, clés étrangères) ;
# 2. cartes de la saison active depuis son CSV, puis cartes référencées (éditions passées) ;
# 3. données du dump (comptes, exemplaires, ledger…), triggers des clés étrangères coupés pendant le
#    chargement (le dump est cohérent, et les cartes référencées sont déjà là).
set -eu

DUMP="$1"
SEASON="$2"
DIR="$(cd "$(dirname "$DUMP")" && pwd)"
REF="${DUMP%.dump}.cards-ref.csv.gz"
PG="${PG_CONTAINER:-palacards-postgres}"
# CSV de la saison active, sinon celui de la dernière saison importée avant elle (saison reconduite).
CSV=""
n="$SEASON"
while [ "$n" -ge 1 ]; do
  if [ -f "$DIR/cards-s$n.csv.gz" ]; then CSV="$DIR/cards-s$n.csv.gz"; break; fi
  n=$((n - 1))
done
[ -n "$CSV" ] || { echo "Aucun cards-s<N>.csv.gz (N <= $SEASON) dans $DIR" >&2; exit 1; }
[ "$n" = "$SEASON" ] || echo "Saison $SEASON reconduite : cartes rechargées depuis $CSV"
for f in "$DUMP" "$REF"; do
  [ -f "$f" ] || { echo "Fichier manquant : $f" >&2; exit 1; }
done
pg() { docker exec -i "$PG" sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 $1"; }

echo "Arrêt de l'API et du front…"
docker stop palacards-api palacards-web >/dev/null 2>&1 || true

docker exec "$PG" sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker cp "$DUMP" "$PG:/tmp/restore.dump"
docker exec "$PG" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error --section=pre-data --section=post-data /tmp/restore.dump'

echo "Cartes de la saison $SEASON…"
"$(dirname "$0")/load-cards.sh" "$CSV" "$SEASON" --restore
echo "Cartes référencées (éditions passées)…"
gunzip -c "$REF" | pg "-c 'create temp table ref (like cards_next including defaults, season smallint)' \
  -c '\\copy ref (id, season, title, rarity, atk, def, views_12m, page_len) from pstdin with (format csv)' \
  -c 'insert into cards (id, season, title, rarity, atk, def, views_12m, page_len)
      select id, season, title, rarity, atk, def, views_12m, page_len from ref on conflict do nothing'"

echo "Données…"
docker exec "$PG" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error --section=data --disable-triggers /tmp/restore.dump && rm /tmp/restore.dump'
pg "-c 'analyze'" >/dev/null

docker start palacards-api palacards-web >/dev/null
echo "Restauration terminée."
