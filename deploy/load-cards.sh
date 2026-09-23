#!/bin/sh
# Charge un cards.csv.gz produit par l'import (PC principal) dans la base de production.
# Usage : ./load-cards.sh cards.csv.gz <saison> [--restore]
#   - nouvelle saison : charge les cartes de la saison N+1 ; la bascule se fait ensuite
#     depuis la page Admin (« Lancer la saison ») ou automatiquement le 1er du mois ;
#   - --restore : recharge une saison existante après une restauration (table cards vidée).
set -eu

CSV="$1"
SEASON="$2"
MODE="${3:-}"
STACK_DIR="${STACK_DIR:-/opt/dockpanel/stacks/palacards}"
. "$STACK_DIR/.env"
SQL_DIR="$(dirname "$0")"

if [ "$MODE" = "--restore" ]; then
  docker exec palacards-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    -c "delete from cards where season = $SEASON and not exists (select 1 from card_instances i where i.season = cards.season and i.card_id = cards.id)"
fi

gunzip -c "$CSV" | docker exec -i palacards-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v season="$SEASON" -f /dev/stdin < /dev/null >/dev/null 2>&1 || true
# psql ne peut pas lire le script et le CSV sur la même entrée : on copie le script dans le conteneur.
docker cp "$SQL_DIR/../tools/import/load_cards.sql" palacards-postgres:/tmp/load_cards.sql
gunzip -c "$CSV" | docker exec -i palacards-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v season="$SEASON" -f /tmp/load_cards.sql
echo "Cartes de la saison $SEASON chargées."
