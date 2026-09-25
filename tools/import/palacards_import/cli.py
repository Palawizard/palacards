import argparse
import os
import sys
from pathlib import Path

from . import build_cards, download, parse_articles, paths, props, views

STEPS = ["download", "parse", "props", "views", "build"]


ENV_FILE_VAR = "PALACARDS_ENV_FILE"


def find_env_file() -> Path | None:
    """`.env` à charger : `PALACARDS_ENV_FILE` s'il est défini, sinon celui de la racine du monorepo
    (dossier contenant pnpm-workspace.yaml), cherchée depuis le paquet puis depuis le dossier courant."""
    override = os.environ.get(ENV_FILE_VAR, "").strip()
    if override:
        env = Path(override).expanduser()
        if not env.is_file():
            raise SystemExit(f"{ENV_FILE_VAR}={override} : fichier introuvable")
        return env
    for start in (Path(__file__).resolve().parent, Path.cwd().resolve()):
        for d in (start, *start.parents):
            if (d / "pnpm-workspace.yaml").is_file():
                env = d / ".env"
                return env if env.is_file() else None
    return None


def load_env() -> None:
    """Charge le .env du monorepo (WIKIMEDIA_USER_AGENT, PALACARDS_DATA) sans écraser l'environnement."""
    env = find_env_file()
    if env is None:
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
    paths.configure()  # PALACARDS_DATA peut venir du .env
    paths.ensure_dirs()
    print(f"données : {paths.DATA}")

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
