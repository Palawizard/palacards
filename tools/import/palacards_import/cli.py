import argparse

from . import build_cards, download, parse_articles, views

STEPS = {
    "download": download.run,
    "parse": parse_articles.run,
    "views": views.run,
    "build": build_cards.run,
}


def main() -> None:
    parser = argparse.ArgumentParser(prog="palacards-import", description="Pipeline d'import PalaCards")
    parser.add_argument("step", choices=[*STEPS, "all"], help="étape à lancer")
    args = parser.parse_args()
    steps = STEPS.values() if args.step == "all" else [STEPS[args.step]]
    for step in steps:
        step()


if __name__ == "__main__":
    main()
