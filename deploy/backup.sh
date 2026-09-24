#!/bin/sh
# Sauvegarde quotidienne de PalaCards (lancée par palacards-backup.timer, 4 h).
# - palacards_<date>.dump : pg_dump au format custom SANS les données de `cards` (quelques Mo) ;
# - palacards_<date>.cards-ref.csv.gz : les seules cartes référencées (exemplaires, ventes, decks,
#   messages), dont les éditions passées qu'aucun CSV d'import ne contient plus ;
# - cards.csv.gz : copie du dernier CSV d'import chargé (cartes de la saison active).
# Garde 14 jours, sur un emplacement hors du disque de la VM (partage NAS monté).
set -eu

STACK_DIR="${STACK_DIR:-/opt/dockpanel/stacks/palacards}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/nas/backups/palacards}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG="${PG_CONTAINER:-palacards-postgres}"

mkdir -p "$BACKUP_DIR"
stamp=$(date +%Y-%m-%d_%H%M)
out="$BACKUP_DIR/palacards_$stamp"

docker exec "$PG" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --exclude-table-data=cards --exclude-table-data=cards_next' > "$out.dump.tmp"
docker exec "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "\copy (
  select c.id, c.season, c.title, c.rarity, c.atk, c.def, c.views_12m, c.page_len from cards c
  where exists (select 1 from card_instances i where i.season = c.season and i.card_id = c.id)
     or exists (select 1 from auctions a where a.season = c.season and a.card_id = c.id)
     or exists (select 1 from battle_decks d where d.season = c.season and d.card_id = c.id)
     or exists (select 1 from messages m where m.card_season = c.season and m.card_id = c.id)
) to stdout with (format csv)"' | gzip > "$out.cards-ref.csv.gz.tmp"
mv "$out.dump.tmp" "$out.dump"
mv "$out.cards-ref.csv.gz.tmp" "$out.cards-ref.csv.gz"
if [ -f "$STACK_DIR/import/cards.csv.gz" ]; then cp -u "$STACK_DIR/import/cards.csv.gz" "$BACKUP_DIR/"; fi

find "$BACKUP_DIR" -name 'palacards_*' -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde écrite : $out.dump ($(du -h "$out.dump" | cut -f1)) + cartes référencées ($(du -h "$out.cards-ref.csv.gz" | cut -f1))"
