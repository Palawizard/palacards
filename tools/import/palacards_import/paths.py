from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"  # ignoré par git
RAW = DATA / "raw"  # dumps téléchargés
WORK = DATA / "work"  # Parquet / DuckDB intermédiaires
OUT = DATA / "out"  # cards.csv.gz final

for d in (RAW, WORK, OUT):
    d.mkdir(parents=True, exist_ok=True)
