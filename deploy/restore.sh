#!/bin/sh
# Restauration d'une sauvegarde PalaCards.
# Usage : ./restore.sh /mnt/nas/backups/palacards/palacards_2026-10-01_0400.dump [saison]
# À tester d'abord dans un conteneur jetable (voir docs/14-exploitation.md, « Tester une restauration »).
# 1. recrée la base vide et applique le dump (schéma + données, sans les cartes) ;
# 2. recharge les cartes depuis le dernier cards.csv.gz sauvegardé.
set -eu

DUMP="$1"
SEASON="${2:-1}"
STACK_DIR="${STACK_DIR:-/opt/dockpanel/stacks/palacards}"
. "$STACK_DIR/.env"

echo "Arrêt de l'API et du front…"
docker stop palacards-api palacards-web

docker exec palacards-postgres dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
docker exec palacards-postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker exec -i palacards-postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < "$DUMP"

CSV="$(dirname "$DUMP")/cards.csv.gz"
if [ -f "$CSV" ]; then
  echo "Rechargement des cartes (saison $SEASON) depuis $CSV…"
  # Les exemplaires référencent les cartes : on les recharge avant de relancer le jeu.
  "$(dirname "$0")/load-cards.sh" "$CSV" "$SEASON" --restore
fi

docker start palacards-api palacards-web
echo "Restauration terminée."
