"""Étape 2 bis : homonymies (page_props) et labels de qualité (categorylinks + linktarget).

Depuis la migration de 2025, `categorylinks` ne contient plus le nom de la catégorie (`cl_to`) :
on cherche d'abord l'`lt_id` des catégories dans `linktarget`, puis leurs membres via `cl_target_id`.
Sortie : `flags.parquet` (page_id, disambiguation, featured, good).
"""

from __future__ import annotations

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from . import paths
from .download import open_dump
from .sqlextract import category_members, category_target_ids, disambiguation_ids

FEATURED = "Article_de_qualité"
GOOD = "Bon_article"


def run(sample: bool = False) -> None:
    max_page = None
    if sample:
        # Les dumps SQL sont triés par page : on s'arrête après le dernier article de l'échantillon.
        max_page = duckdb.sql(f"SELECT max(page_id) FROM '{(paths.WORK / 'articles.parquet').as_posix()}'").fetchone()[0]
    print("props : homonymies (page_props)…")
    with open_dump("page_props.sql.gz") as f:
        disamb = disambiguation_ids(f, max_page)
    print(f"  {len(disamb):,} pages d'homonymie")
    print("props : catégories de qualité (linktarget)…")
    with open_dump("linktarget.sql.gz") as f:
        targets = category_target_ids(f, [FEATURED, GOOD])
    by_title = {title: lt_id for lt_id, title in targets.items()}
    if set(by_title) != {FEATURED, GOOD}:
        raise SystemExit(f"Catégories de qualité introuvables dans linktarget : {by_title}")
    print("props : membres (categorylinks)…")
    with open_dump("categorylinks.sql.gz") as f:
        members = category_members(f, targets, max_page)
    featured = members[by_title[FEATURED]]
    good = members[by_title[GOOD]]
    print(f"  {len(featured):,} articles de qualité, {len(good):,} bons articles")
    ids = sorted(disamb | featured | good)
    table = pa.table(
        {
            "page_id": pa.array(ids, pa.int64()),
            "disambiguation": [i in disamb for i in ids],
            "featured": [i in featured for i in ids],
            "good": [i in good for i in ids],
        }
    )
    pq.write_table(table, paths.WORK / "flags.parquet")
    print(f"props : {paths.WORK / 'flags.parquet'} écrit")
