#!/bin/sh
# Sauvegarde quotidienne de PalaCards (lancée par palacards-backup.timer, 4 h).
# Dump au format custom sans les données de `cards` (recréables depuis cards.csv.gz) :
# comptes, exemplaires, ledger, marché, échanges, messages… quelques Mo.
# Garde 14 jours, sur un emplacement hors du disque de la VM (partage NAS monté).
set -eu

STACK_DIR="${STACK_DIR:-/opt/dockpanel/stacks/palacards}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/nas/backups/palacards}"
KEEP_DAYS="${KEEP_DAYS:-14}"

. "$STACK_DIR/.env"
mkdir -p "$BACKUP_DIR"
stamp=$(date +%Y-%m-%d_%H%M)
out="$BACKUP_DIR/palacards_$stamp.dump"

docker exec palacards-postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --exclude-table-data=cards --exclude-table-data=cards_next > "$out.tmp"
mv "$out.tmp" "$out"
# Le dernier CSV de cartes chargé est gardé à côté (nécessaire pour restaurer la table cards).
if [ -f "$STACK_DIR/import/cards.csv.gz" ]; then cp -u "$STACK_DIR/import/cards.csv.gz" "$BACKUP_DIR/"; fi

find "$BACKUP_DIR" -name 'palacards_*.dump' -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde écrite : $out ($(du -h "$out" | cut -f1))"
