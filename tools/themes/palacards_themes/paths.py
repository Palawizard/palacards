"""Emplacements des données (hors dépôt : plusieurs Go)."""

from __future__ import annotations

import os
from pathlib import Path

DATA = Path(os.environ.get("PALACARDS_THEMES_DATA", "/srv/nas/palacards-themes/data"))
DUMPS = DATA / "dumps"
RAW = DATA / "raw"  # TSV intermédiaires (dumps analysés, Wikidata)
THEMES = DATA / "themes"  # un dossier par booster : fiche, aperçu, ids, SQL


def index_db(season: int) -> Path:
    return DATA / f"index-s{season}.duckdb"


def current_index() -> Path:
    """Index le plus récent (saison la plus haute)."""
    found = sorted(DATA.glob("index-s*.duckdb"), key=lambda p: int(p.stem.split("-s")[1]))
    if not found:
        raise SystemExit("Aucun index : lance d'abord `palacards-themes index`.")
    return found[-1]


USER_AGENT = "PalaCards-themes/0.1 (https://github.com/Palawizard/palacards)"
