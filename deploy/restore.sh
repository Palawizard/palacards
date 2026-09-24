#!/bin/sh
# Restauration d'une sauvegarde PalaCards (voir docs/14-exploitation.md).
# Usage : ./restore.sh /mnt/nas/backups/palacards/palacards_2026-10-01_0400.dump <saison active>
# Le dossier du dump doit contenir cards-s<N>.csv.gz (CSV d'import de la saison active, ou de la
# dernière saison importée avant elle si elle a été reconduite) et palacards_<date>.cards-ref.csv.gz.
# 1. base recréée, schéma complet (tables vides, index, clés étrangères) ;
# 2. cartes de la saison active depuis son CSV, puis celles de la saison suivante si elle avait été
#    chargée sans être activée (cards-s<N+1>.csv.gz présent), puis cartes référencées (éditions passées) ;
# 3. données du dump (comptes, exemplaires, ledger…), triggers des clés étrangères coupés pendant le
#    chargement (le dump est cohérent, et les cartes référencées sont déjà là).
# L'API et le front sont arrêtés pendant la restauration puis relancés, seulement si la cible est le
# Postgres de prod (palacards-postgres). Test de restauration dans un Postgres temporaire pendant que
# la prod tourne : PG_CONTAINER=<conteneur de test> ./restore.sh …  (la prod n'est pas touchée).
# APP_CONTAINERS force la liste des conteneurs à arrêter/relancer (vide : aucun).
set -eu

DUMP="$1"
SEASON="$2"
DIR="$(cd "$(dirname "$DUMP")" && pwd)"
REF="${DUMP%.dump}.cards-ref.csv.gz"
PG="${PG_CONTAINER:-palacards-postgres}"
if [ "$PG" = palacards-postgres ]; then DEFAULT_APPS="palacards-api palacards-web"; else DEFAULT_APPS=""; fi
APPS="${APP_CONTAINERS-$DEFAULT_APPS}"
# CSV de la saison active, sinon celui de la dernière saison importée avant elle (saison reconduite).
CSV=""
n="$SEASON"
while [ "$n" -ge 1 ]; do
  if [ -f "$DIR/cards-s$n.csv.gz" ]; then CSV="$DIR/cards-s$n.csv.gz"; break; fi
  n=$((n - 1))
done
[ -n "$CSV" ] || { echo "Aucun cards-s<N>.csv.gz (N <= $SEASON) dans $DIR" >&2; exit 1; }
[ "$n" = "$SEASON" ] || echo "Saison $SEASON reconduite : cartes rechargées depuis $CSV"
# Saison suivante importée mais pas encore activée : ses cartes ne sont ni dans le dump (données de
# `cards` exclues) ni dans les cartes référencées. Sans elles, la bascule reconduirait la saison active.
# load-cards.sh ne copie le CSV qu'après un chargement réussi : sa présence prouve qu'il a été chargé.
# RESTORE_NEXT_SEASON=0 pour l'ignorer (CSV préparé après la date du dump, par exemple).
NEXT_CSV="$DIR/cards-s$((SEASON + 1)).csv.gz"
if [ "${RESTORE_NEXT_SEASON:-1}" = 0 ] || [ ! -f "$NEXT_CSV" ]; then NEXT_CSV=""; fi
for f in "$DUMP" "$REF"; do
  [ -f "$f" ] || { echo "Fichier manquant : $f" >&2; exit 1; }
done
pg() { docker exec -i "$PG" sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 $1"; }

if [ -n "$APPS" ]; then
  echo "Arrêt de : $APPS…"
  # shellcheck disable=SC2086 # liste de conteneurs séparés par des espaces
  docker stop $APPS >/dev/null 2>&1 || true
else
  echo "Conteneurs applicatifs non touchés (cible : $PG)."
fi

docker exec "$PG" sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker cp "$DUMP" "$PG:/tmp/restore.dump"
docker exec "$PG" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error --section=pre-data --section=post-data /tmp/restore.dump'

echo "Cartes de la saison $SEASON…"
"$(dirname "$0")/load-cards.sh" "$CSV" "$SEASON" --restore
if [ -n "$NEXT_CSV" ]; then
  echo "Cartes de la saison suivante $((SEASON + 1)) (chargée, pas encore activée)…"
  "$(dirname "$0")/load-cards.sh" "$NEXT_CSV" "$((SEASON + 1))" --restore
fi
echo "Cartes référencées (éditions passées)…"
gunzip -c "$REF" | pg "-c 'create temp table ref (like cards_next including defaults, season smallint)' \
  -c '\\copy ref (id, season, title, rarity, atk, def, views_12m, page_len) from pstdin with (format csv)' \
  -c 'insert into cards (id, season, title, rarity, atk, def, views_12m, page_len)
      select id, season, title, rarity, atk, def, views_12m, page_len from ref on conflict do nothing'"

echo "Données…"
docker exec "$PG" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error --section=data --disable-triggers /tmp/restore.dump && rm /tmp/restore.dump'
pg "-c 'analyze'" >/dev/null

if [ -n "$APPS" ]; then
  # shellcheck disable=SC2086
  docker start $APPS >/dev/null
fi
echo "Restauration terminée."
