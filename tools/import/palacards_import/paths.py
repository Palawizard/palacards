"""Emplacements des données de l'import (dumps, intermédiaires, export).

Par défaut `tools/import/data/` quand le paquet est installé depuis le dépôt (`pip install -e .`),
sinon `./data` du dossier courant. `PALACARDS_DATA` (environnement ou `.env`) force un autre dossier.
Le `pnpm db:seed` lit l'échantillon dans `tools/import/data/out/` : garder l'emplacement par défaut
pour l'utiliser.
"""

from __future__ import annotations

import os
from pathlib import Path

DATA_ENV = "PALACARDS_DATA"
# tools/import/ quand le paquet est utilisé depuis le dépôt (installation éditable).
SOURCE_ROOT = Path(__file__).resolve().parent.parent

DATA: Path  # ignoré par git
RAW: Path  # dumps téléchargés (import complet)
WORK: Path  # Parquet intermédiaires
OUT: Path  # cards.csv.gz final


def default_data_dir() -> Path:
    env = os.environ.get(DATA_ENV, "").strip()
    if env:
        return Path(env).expanduser().resolve()
    if (SOURCE_ROOT / "pyproject.toml").is_file():
        return SOURCE_ROOT / "data"
    return Path.cwd() / "data"


def configure(data_dir: str | Path | None = None) -> None:
    """(Re)calcule les dossiers ; à rappeler après le chargement du `.env` (PALACARDS_DATA)."""
    global DATA, RAW, WORK, OUT
    DATA = Path(data_dir).expanduser().resolve() if data_dir else default_data_dir()
    RAW = DATA / "raw"
    WORK = DATA / "work"
    OUT = DATA / "out"


def ensure_dirs() -> None:
    for d in (RAW, WORK, OUT):
        d.mkdir(parents=True, exist_ok=True)


def use_sample_dirs() -> None:
    """Mode échantillon (`--limit`) : intermédiaires séparés pour ne pas écraser l'import complet."""
    global WORK
    WORK = DATA / "sample"
    WORK.mkdir(parents=True, exist_ok=True)


def sql_str(value: str | Path) -> str:
    """Littéral SQL (DuckDB) entre apostrophes, apostrophes doublées : `C:/Users/O'Neil/x` reste valide."""
    text = value.as_posix() if isinstance(value, Path) else str(value)
    return "'" + text.replace("'", "''") + "'"


configure()
