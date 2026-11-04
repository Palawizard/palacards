"""Caisses de la semaine (suggestion n° 126) : les quatre niveaux d'un thème, en une transaction.

Le contenu de chaque niveau = les cartes les plus lues du thème dans chaque rareté, en nombre fixé par
`CASE_CONTENT` (copie de `packages/game/src/cases.ts`, à garder identique). Le thème vient soit d'un booster
déjà en base (`--theme <id>` : ses cartes), soit d'une fiche YAML de booster (sélection de l'index local).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

TIERS = ["bronze", "silver", "gold", "legendary"]
# packages/game/src/cases.ts › CASE_CONTENT
CASE_CONTENT: dict[str, dict[str, int]] = {
    "bronze": {"R": 12, "SR": 10, "UR": 6, "L": 2},
    "silver": {"SR": 10, "UR": 12, "L": 5},
    "gold": {"UR": 12, "L": 10},
    "legendary": {"UR": 10, "L": 15},
}
PARIS = ZoneInfo("Europe/Paris")


def next_monday_evening(after: datetime) -> datetime:
    """Prochain lundi 23 h 59 (heure de Paris), en UTC : l'heure de renouvellement des caisses."""
    local = after.astimezone(PARIS)
    days = (0 - local.weekday()) % 7
    target = (local + timedelta(days=days)).replace(hour=23, minute=59, second=0, microsecond=0)
    if target <= local:
        target += timedelta(days=7)
    return target.astimezone(UTC)


def _lit(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def script(
    collection: str,
    source_sql: str,
    season: int,
    starts: datetime,
    ends: datetime,
    by: str,
    commit: bool,
    copy_ids: list[int] | None = None,
) -> str:
    """Script psql : `source_sql` remplit `_ids` (ou `copy_ids` par COPY), puis quatre caisses et leur contenu."""
    fill = (
        "COPY _ids FROM STDIN;\n" + "\n".join(str(i) for i in sorted(copy_ids)) + "\n\\.\n"
        if copy_ids is not None
        else f"INSERT INTO _ids {source_sql} ON CONFLICT DO NOTHING;\n"
    )
    key = f"k.collection = {_lit(collection)} AND k.starts_at = {_lit(starts.isoformat())}"
    tiers = []
    checks = []
    for tier in TIERS:
        content = CASE_CONTENT[tier]
        wanted = " OR ".join(f"(c.rarity = '{r}' AND c.n <= {n})" for r, n in content.items())
        tiers.append(f"""
INSERT INTO cases (collection, tier, season, starts_at, ends_at, created_by)
VALUES ({_lit(collection)}, '{tier}', {season}, {_lit(starts.isoformat())}, {_lit(ends.isoformat())},
        (SELECT id FROM "user" WHERE username = {_lit(by)}))
RETURNING id AS {tier}_id \\gset
INSERT INTO case_cards (case_id, card_id, rarity, pos)
SELECT :{tier}_id, c.id, c.rarity,
       (row_number() OVER (ORDER BY c.rarity DESC, c.views_12m DESC, c.id) - 1)::smallint
FROM _ranked c WHERE {wanted};""")
        # Chaque rareté qu'une issue du niveau peut donner doit avoir au moins une carte.
        checks += [
            f"""  IF NOT EXISTS (SELECT 1 FROM cases k JOIN case_cards cc ON cc.case_id = k.id
                 WHERE {key} AND k.tier = '{tier}' AND cc.rarity = '{r}') THEN
    RAISE EXCEPTION 'Caisse {tier} : aucune carte {r} dans le thème.';
  END IF;"""
            for r in content
        ]
    return f"""
\\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF (SELECT id FROM seasons WHERE status = 'active') <> {season} THEN
    RAISE EXCEPTION 'La saison active n''est plus la {season}.';
  END IF;
  IF EXISTS (SELECT 1 FROM cases WHERE collection = {_lit(collection)} AND ends_at > {_lit(starts.isoformat())}) THEN
    RAISE EXCEPTION 'Des caisses « % » sont déjà en vente sur ces dates.', {_lit(collection)};
  END IF;
END $$;
CREATE TEMP TABLE _ids (id bigint PRIMARY KEY) ON COMMIT DROP;
{fill}CREATE TEMP TABLE _ranked ON COMMIT DROP AS
SELECT c.id, c.rarity, c.views_12m,
       row_number() OVER (PARTITION BY c.rarity ORDER BY c.views_12m DESC, c.id) AS n
FROM cards c JOIN _ids i ON i.id = c.id WHERE c.season = {season};
{"".join(tiers)}
DO $$ BEGIN
{chr(10).join(checks)}
END $$;
SELECT 'case', k.tier, k.id, count(cc.card_id), string_agg(DISTINCT cc.rarity::text, '/')
FROM cases k LEFT JOIN case_cards cc ON cc.case_id = k.id
WHERE {key}
GROUP BY k.tier, k.id ORDER BY k.id;
{"COMMIT;" if commit else "ROLLBACK;"}
"""
