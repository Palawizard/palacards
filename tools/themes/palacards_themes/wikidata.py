"""Données Wikidata des articles du Wikipédia FR, en quelques requêtes en bloc sur QLever.

QLever (Université de Fribourg) renvoie des millions de lignes en quelques secondes là où le
Wikidata Query Service expire au bout de 60 s : 2,9 millions de descriptions en ~20 s, 3,8 millions
de P31 en ~15 s (mesuré le 2026-11-04). Les requêtes transitives (`P31/P279*`) peuvent dépasser la
mémoire du serveur public : on télécharge donc P279 en entier et on fait la fermeture en local.
"""

from __future__ import annotations

import re
import time

import requests

from . import paths

ENDPOINT = "https://qlever.dev/api/wikidata"
PREFIXES = """PREFIX schema: <http://schema.org/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
"""
FRWIKI = "?a schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> ."
# Propriétés gardées pour chaque article : nature, métier, sport, nationalité, pays, genre.
ITEM_PROPS = ["P31", "P106", "P641", "P27", "P17", "P136"]
_Q = re.compile(r"<http://www\.wikidata\.org/entity/Q(\d+)>")


def _fetch(name: str, query: str, attempts: int = 6) -> None:
    """Résultat TSV de la requête dans raw/<name>.qlever.tsv (brut)."""
    paths.RAW.mkdir(parents=True, exist_ok=True)
    dest = paths.RAW / f"{name}.qlever.tsv"
    for attempt in range(1, attempts + 1):
        t = time.time()
        try:
            with requests.post(
                ENDPOINT,
                data={"query": PREFIXES + query},
                headers={"Accept": "text/tab-separated-values", "User-Agent": paths.USER_AGENT},
                stream=True,
                timeout=(30, 600),
            ) as r:
                r.raise_for_status()
                with open(dest, "wb") as f:
                    f.writelines(r.iter_content(1 << 20))
            with open(dest, "rb") as f:
                head = f.read(200)
                f.seek(max(0, dest.stat().st_size - 1000))
                tail = f.read()
            if head.lstrip().startswith(b"{"):
                raise RuntimeError(head.decode("utf-8", "replace"))
            # Erreur en cours d'export (mémoire du serveur public) : QLever l'ajoute à la fin du résultat.
            if b"An error has occurred while exporting" in tail:
                raise RuntimeError(tail.decode("utf-8", "replace").strip().splitlines()[-1])
            print(f"  {name} : {dest.stat().st_size / 1e6:.0f} Mo en {time.time() - t:.0f} s")
            return
        except (requests.RequestException, RuntimeError) as err:
            print(f"  {name} : échec ({err}), essai {attempt}/{attempts}")
            time.sleep(30 * attempt)
    raise SystemExit(f"QLever : impossible de récupérer {name}")


def _pairs(name: str, out: str) -> int:
    """Convertit deux colonnes d'entités en TSV d'entiers (Q123 -> 123)."""
    n = 0
    with open(paths.RAW / f"{name}.qlever.tsv", encoding="utf-8") as f, open(paths.RAW / out, "w") as w:
        next(f)
        for line in f:
            ids = _Q.findall(line)
            if len(ids) == 2:
                w.write(f"{ids[0]}\t{ids[1]}\n")
                n += 1
    return n


def _texts(name: str, out: str) -> int:
    """Entité + texte en français ("…"@fr) -> TSV (texte sans tabulation)."""
    n = 0
    with open(paths.RAW / f"{name}.qlever.tsv", encoding="utf-8") as f, open(paths.RAW / out, "w") as w:
        next(f)
        for line in f:
            col = line.rstrip("\n").split("\t", 1)
            m = _Q.match(col[0])
            if not m or len(col) < 2:
                continue
            text = col[1]
            if text.startswith('"'):
                text = text[1 : text.rfind('"')]
            text = text.replace("\\\"", '"').replace("\\\\", "\\").replace("\t", " ")
            w.write(f"{m.group(1)}\t{text}\n")
            n += 1
    return n


def fetch_all() -> None:
    for prop in ITEM_PROPS:
        _fetch(prop, f"SELECT ?item ?v WHERE {{ {FRWIKI} ?item wdt:{prop} ?v . }}")
        print(f"    {_pairs(prop, f'{prop}.tsv'):,} lignes")
    _fetch("P279", "SELECT ?c ?p WHERE { ?c wdt:P279 ?p . }")
    print(f"    {_pairs('P279', 'P279.tsv'):,} lignes")
    _fetch("desc", f'SELECT ?item ?d WHERE {{ {FRWIKI} ?item schema:description ?d . FILTER(LANG(?d) = "fr") }}')
    print(f"    {_texts('desc', 'desc.tsv'):,} descriptions")
    # Libellés des classes (sujets et objets de P279) et des valeurs des propriétés des articles.
    _fetch(
        "labels_classes",
        'SELECT ?v ?l WHERE { { SELECT DISTINCT ?v WHERE { { ?c wdt:P279 ?v } UNION { ?v wdt:P279 ?x } } } '
        '?v rdfs:label ?l . FILTER(LANG(?l) = "fr") }',
    )
    n = _texts("labels_classes", "labels_classes.tsv")
    values = " UNION ".join(f"{{ {FRWIKI} ?item wdt:{p} ?v . }}" for p in ["P106", "P641", "P27", "P17", "P136"])
    _fetch(
        "labels_values",
        f'SELECT ?v ?l WHERE {{ {{ SELECT DISTINCT ?v WHERE {{ {values} }} }} ?v rdfs:label ?l . '
        'FILTER(LANG(?l) = "fr") }',
    )
    n += _texts("labels_values", "labels_values.tsv")
    print(f"    {n:,} libellés")


def labels(qids: list[int]) -> dict[int, str]:
    """Libellés français de quelques entités (aperçu, recherche) : une petite requête."""
    out: dict[int, str] = {}
    for i in range(0, len(qids), 400):
        chunk = " ".join(f"wd:Q{q}" for q in qids[i : i + 400])
        r = requests.post(
            ENDPOINT,
            data={
                "query": PREFIXES + "PREFIX wd: <http://www.wikidata.org/entity/>\n"
                f'SELECT ?v ?l WHERE {{ VALUES ?v {{ {chunk} }} ?v rdfs:label ?l . FILTER(LANG(?l) = "fr") }}'
            },
            headers={"Accept": "text/tab-separated-values", "User-Agent": paths.USER_AGENT},
            timeout=60,
        )
        r.raise_for_status()
        for line in r.text.splitlines()[1:]:
            col = line.split("\t", 1)
            m = _Q.match(col[0])
            if m and len(col) == 2:
                out[int(m.group(1))] = col[1][1 : col[1].rfind('"')]
    return out
