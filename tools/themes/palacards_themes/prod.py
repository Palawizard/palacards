"""Accès à la base de prod (vm-apps) par SSH : export des cartes, exécution d'un script SQL."""

from __future__ import annotations

import subprocess

from . import paths

STACK = "/opt/dockpanel/stacks/palacards"
PSQL = f"cd {STACK} && docker compose exec -T postgres psql -U palacards -d palacards -v ON_ERROR_STOP=1 -X -q"


def psql(script: str, timeout: int = 600) -> str:
    """Exécute un script SQL (avec d'éventuelles données COPY … FROM STDIN) ; renvoie la sortie."""
    r = subprocess.run(
        ["ssh", "vm-apps", PSQL + " -At"], input=script.encode(), capture_output=True, timeout=timeout, check=False
    )
    if r.returncode != 0:
        raise SystemExit(f"psql : {r.stderr.decode(errors='replace').strip()}")
    return r.stdout.decode()


def active_season() -> int:
    return int(psql("select id from seasons where status = 'active';").strip())


def export_cards(season: int) -> None:
    """raw/cards.csv : id, titre, rareté, vues sur 12 mois des cartes de la saison."""
    paths.RAW.mkdir(parents=True, exist_ok=True)
    query = (
        f"\\copy (select id, title, rarity, views_12m from cards where season = {season}) "
        "to stdout with (format csv)"
    )
    with open(paths.RAW / "cards.csv", "wb") as out:
        r = subprocess.run(["ssh", "vm-apps", PSQL + " -At"], input=query.encode(), stdout=out, timeout=900, check=False)
    if r.returncode != 0:
        raise SystemExit("Export des cartes impossible.")


def backup() -> None:
    """Sauvegarde de la base avant une création (service habituel de vm-apps)."""
    r = subprocess.run(["ssh", "vm-apps", "systemctl start palacards-backup.service"], timeout=900, check=False)
    if r.returncode != 0:
        raise SystemExit("Sauvegarde impossible : création annulée.")
