from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"  # ignoré par git
RAW = DATA / "raw"  # dumps téléchargés (import complet)
WORK = DATA / "work"  # Parquet intermédiaires
OUT = DATA / "out"  # cards.csv.gz final


def use_sample_dirs() -> None:
    """Mode échantillon (`--limit`) : intermédiaires séparés pour ne pas écraser l'import complet."""
    global WORK
    WORK = DATA / "sample"
    WORK.mkdir(parents=True, exist_ok=True)


for d in (RAW, WORK, OUT):
    d.mkdir(parents=True, exist_ok=True)
