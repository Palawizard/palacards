#!/bin/bash
# Sauvegarde quotidienne de PalaCards (lancée par palacards-backup.timer, 4 h).
# - palacards_<date>.dump : pg_dump au format custom SANS les données de `cards` (quelques Mo) ;
# - palacards_<date>.cards-ref.csv.gz : les seules cartes référencées (exemplaires, ventes, decks,
#   messages), dont les éditions passées qu'aucun CSV d'import ne contient plus ;
# - cards-s<N>.csv.gz : les CSV d'import chargés, un par saison (copiés par load-cards.sh).
# Garde 14 jours, sur un emplacement hors du disque de la VM (partage NAS monté).
set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/dockpanel/stacks/palacards}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/nas/backups/palacards}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG="${PG_CONTAINER:-palacards-postgres}"

# Le partage NAS doit être monté : sinon on remplirait le disque de la VM sans le savoir.
existing="$BACKUP_DIR"
while [ ! -d "$existing" ]; do existing="$(dirname "$existing")"; done
if [ "$(df --output=target "$existing" | tail -n 1)" = "/" ] && [ "${ALLOW_LOCAL_BACKUP:-0}" != 1 ]; then
  echo "BACKUP_DIR est sur le disque système ($BACKUP_DIR) : partage NAS non monté ? (ALLOW_LOCAL_BACKUP=1 pour forcer)" >&2
  exit 1
fi
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
# Un dump vide ou un CSV de cartes référencées vide = sauvegarde ratée (la base a toujours des comptes).
[ -s "$out.dump.tmp" ] || { echo "Dump vide" >&2; exit 1; }
[ "$(gunzip -c "$out.cards-ref.csv.gz.tmp" | head -c 1 | wc -c)" -gt 0 ] || echo "Attention : aucune carte référencée (base sans exemplaires ?)" >&2
mv "$out.dump.tmp" "$out.dump"
mv "$out.cards-ref.csv.gz.tmp" "$out.cards-ref.csv.gz"
for csv in "$STACK_DIR"/import/cards-s*.csv.gz; do
  [ -f "$csv" ] && cp -u "$csv" "$BACKUP_DIR/"
done

find "$BACKUP_DIR" -name 'palacards_*' -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde écrite : $out.dump ($(du -h "$out.dump" | cut -f1)) + cartes référencées ($(du -h "$out.cards-ref.csv.gz" | cut -f1))"
