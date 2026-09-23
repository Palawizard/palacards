import argparse
import os
import sys
from pathlib import Path

from . import build_cards, download, parse_articles, paths, props, views

STEPS = ["download", "parse", "props", "views", "build"]


def load_env() -> None:
    """Charge le .env racine du monorepo (WIKIMEDIA_USER_AGENT) sans écraser l'environnement."""
    env = Path(__file__).resolve().parents[3] / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.strip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    parser = argparse.ArgumentParser(prog="palacards-import", description="Pipeline d'import PalaCards")
    parser.add_argument("step", choices=[*STEPS, "all"], help="étape à lancer (all = toutes, dans l'ordre)")
    parser.add_argument(
        "--limit",
        type=int,
        help="échantillon : N premiers articles, lus en flux sans téléchargement complet, paliers mis à l'échelle",
    )
    parser.add_argument("--months", type=int, help="mois de pages vues (défaut : 12, ou 1 en échantillon)")
    parser.add_argument("--date", help="exécution de dump à utiliser (AAAAMMJJ, défaut : dernière complète)")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    load_env()

    sample = args.limit is not None
    if sample:
        paths.use_sample_dirs()
    months = args.months or (1 if sample else 12)
    run = {
        "download": lambda: None if sample else download.run(args.date),
        "parse": lambda: parse_articles.run(args.limit),
        "props": lambda: props.run(sample),
        "views": lambda: views.run(months),
        "build": lambda: build_cards.run(sample),
    }
    for step in STEPS if args.step == "all" else [args.step]:
        run[step]()


if __name__ == "__main__":
    main()
