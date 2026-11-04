"""Dumps SQL du Wikipédia FR -> TSV : pages de catégories, liens de catégories, identifiants Wikidata.

Depuis 2025, `categorylinks` ne contient plus le nom de la catégorie : `cl_target_id` renvoie à `linktarget`.
Les dumps sont en `CHARSET=binary` : lecture en octets, ligne par ligne, avec des regex compilées
(même méthode que `tools/import/palacards_import/sqlextract.py`).
"""

from __future__ import annotations

import gzip
import re
import time
from pathlib import Path

import requests

from . import paths

BASE = "https://dumps.wikimedia.org/frwiki/latest"
TABLES = ["page", "categorylinks", "linktarget", "page_props"]
_STR = rb"'((?:[^'\\]|\\.)*)'"
_SKIP = rb"'(?:[^'\\]|\\.)*'"
_UNESCAPE = re.compile(rb"\\(.)")


def _title(raw: bytes) -> str:
    return _UNESCAPE.sub(rb"\1", raw).decode("utf-8", "replace").replace("_", " ")


def download(force: bool = False) -> None:
    paths.DUMPS.mkdir(parents=True, exist_ok=True)
    http = requests.Session()
    http.headers["User-Agent"] = paths.USER_AGENT
    for table in TABLES:
        name = f"frwiki-latest-{table}.sql.gz"
        dest = paths.DUMPS / name
        size = int(http.head(f"{BASE}/{name}", timeout=30, allow_redirects=True).headers["Content-Length"])
        if dest.exists() and dest.stat().st_size == size and not force:
            print(f"  {name} : déjà là")
            continue
        start = time.time()
        with http.get(f"{BASE}/{name}", stream=True, timeout=60) as r, open(dest, "wb") as f:
            r.raise_for_status()
            f.writelines(r.iter_content(1 << 20))
        if dest.stat().st_size != size:
            raise SystemExit(f"{name} : taille inattendue")
        print(f"  {name} : {size / 1e6:.0f} Mo en {time.time() - start:.0f} s")


def _lines(table: str):
    """Lignes de valeurs des INSERT de `table`.

    Deux formats : l'ancien (`INSERT … VALUES (…),(…);` sur une seule ligne) et celui des dumps de 2026
    (`INSERT … VALUES` seul, puis un tuple par ligne jusqu'au `;`).
    """
    prefix = f"INSERT INTO `{table}` VALUES".encode()
    inside = False
    with gzip.open(paths.DUMPS / f"frwiki-latest-{table}.sql.gz", "rb") as f:
        for line in f:
            if line.startswith(prefix):
                inside = True
                rest = line[len(prefix):].strip()
                if rest:
                    yield rest
                    inside = not rest.endswith(b";")
            elif inside:
                if line.startswith(b"("):
                    yield line
                    if line.rstrip().endswith(b";"):
                        inside = False
                else:
                    inside = False


def _write(name: str, rows) -> int:
    paths.RAW.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(paths.RAW / name, "w", encoding="utf-8") as out:
        for row in rows:
            out.write("\t".join(row) + "\n")
            n += 1
    return n


def parse() -> None:
    """Écrit raw/cat_pages.tsv, linktarget.tsv, cl_pages.tsv, cl_subcats.tsv, qids.tsv."""
    t = time.time()
    # page : (page_id, page_namespace, page_title, …) ; seules les catégories (14) servent.
    cat_page = re.compile(rb"\((\d+),14," + _STR + rb",")
    n = _write("cat_pages.tsv", ((pid.decode(), _title(title)) for line in _lines("page")
                                 for pid, title in cat_page.findall(line)))
    print(f"  pages de catégories : {n:,} ({time.time() - t:.0f} s)")

    t = time.time()
    lt = re.compile(rb"\((\d+),14," + _STR + rb"\)")
    n = _write("linktarget.tsv", ((i.decode(), _title(title)) for line in _lines("linktarget")
                                  for i, title in lt.findall(line)))
    print(f"  cibles de catégories : {n:,} ({time.time() - t:.0f} s)")

    t = time.time()
    # (cl_from, cl_sortkey, cl_timestamp, cl_sortkey_prefix, cl_type, cl_collation_id, cl_target_id)
    cl = re.compile(rb"\((\d+)," + _SKIP + b"," + _SKIP + b"," + _SKIP + rb",'(page|subcat)',\d+,(\d+)\)",
                    re.DOTALL)
    paths.RAW.mkdir(parents=True, exist_ok=True)
    pages = subcats = 0
    with open(paths.RAW / "cl_pages.tsv", "w") as fp, open(paths.RAW / "cl_subcats.tsv", "w") as fs:
        for line in _lines("categorylinks"):
            for src, kind, target in cl.findall(line):
                if kind == b"page":
                    fp.write(f"{src.decode()}\t{target.decode()}\n")
                    pages += 1
                else:
                    fs.write(f"{src.decode()}\t{target.decode()}\n")
                    subcats += 1
    print(f"  liens : {pages:,} articles, {subcats:,} sous-catégories ({time.time() - t:.0f} s)")

    t = time.time()
    pp = re.compile(rb"\((\d+),'wikibase_item','Q(\d+)'")
    n = _write("qids.tsv", ((p.decode(), q.decode()) for line in _lines("page_props")
                            for p, q in pp.findall(line)))
    print(f"  identifiants Wikidata : {n:,} ({time.time() - t:.0f} s)")


def dump_date() -> str:
    """Date de téléchargement du dump des pages (AAAA-MM-JJ)."""
    mtime = Path(paths.DUMPS / "frwiki-latest-page.sql.gz").stat().st_mtime
    return time.strftime("%Y-%m-%d", time.gmtime(mtime))
