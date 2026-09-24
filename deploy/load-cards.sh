#!/bin/sh
# Charge un cards.csv.gz produit par l'import (PC principal) dans la base de production.
# Usage : ./load-cards.sh cards.csv.gz <saison> [--restore]
#   Premier chargement (aucune saison active) : la saison est activée tout de suite.
#   Ensuite : charge la saison N+1 sans l'activer ; la bascule se fait depuis la page Admin
#   (« Lancer la saison ») ou automatiquement le 1er du mois.
#   --restore : utilisé par restore.sh (les saisons viennent du dump, rien n'est activé).
#   Refusé si la saison a déjà des cartes ou si les effectifs par rareté sont incohérents.
set -eu

CSV="$1"
SEASON="$2"
RESTORE="$( [ "${3:-}" = "--restore" ] && echo "-v restore=1" || true)"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PG="${PG_CONTAINER:-palacards-postgres}"

# Identifiants lus dans le conteneur (pas de `. .env` : certaines valeurs contiennent des parenthèses).
docker cp "$REPO_DIR/tools/import/load_cards.sql" "$PG:/tmp/load_cards.sql"
gunzip -c "$CSV" | docker exec -i "$PG" sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v season="$1" $2 -f /tmp/load_cards.sql' sh "$SEASON" "$RESTORE"
# Copie datée par saison, reprise par backup.sh : la restauration recharge le CSV de la bonne saison.
if [ -z "$RESTORE" ]; then
  mkdir -p "$REPO_DIR/import"
  dest="$REPO_DIR/import/cards-s$SEASON.csv.gz"
  [ "$(cd "$(dirname "$CSV")" && pwd)/$(basename "$CSV")" = "$dest" ] || cp "$CSV" "$dest"
fi
echo "Cartes de la saison $SEASON chargées."
