"""Étape 2 : lit le XML multistream en streaming (mwxml) et écrit `articles.parquet`.

Une ligne par article de l'espace principal (ns 0) hors redirections :
page_id, title, page_len (octets du wikicode), refs, sections, images, links.
"""

from __future__ import annotations

import bz2
from collections.abc import Iterator
from typing import BinaryIO

import mwxml
import pyarrow as pa
import pyarrow.parquet as pq

from . import paths
from .download import open_dump
from .wikitext import measure

SCHEMA = pa.schema(
    [
        ("page_id", pa.int64()),
        ("title", pa.string()),
        ("page_len", pa.int32()),
        ("refs", pa.int32()),
        ("sections", pa.int32()),
        ("images", pa.int32()),
        ("links", pa.int32()),
    ]
)
BATCH = 20_000


def iter_articles(stream: BinaryIO) -> Iterator[dict[str, int | str]]:
    """Articles ns 0 hors redirections, dans l'ordre du dump (page_id croissant)."""
    for page in mwxml.Dump.from_file(stream):
        if page.namespace != 0 or page.redirect:
            continue
        revision = None
        for revision in page:  # le dump « pages-articles » ne contient que la dernière révision
            pass
        if revision is None:
            continue
        main = revision.slots.contents.get("main") if revision.slots else None
        text = (main.text if main else None) or ""
        if text.lstrip().lower().startswith("#redirect"):
            continue
        stats = measure(text)
        yield {
            "page_id": int(page.id),
            "title": page.title.replace("_", " "),
            "page_len": int(main.bytes) if main and main.bytes is not None else len(text.encode("utf-8")),
            "refs": stats.refs,
            "sections": stats.sections,
            "images": stats.images,
            "links": stats.links,
        }


def write_parquet(rows: Iterator[dict[str, int | str]], out, limit: int | None = None) -> int:
    count = 0
    batch: list[dict[str, int | str]] = []
    with pq.ParquetWriter(out, SCHEMA) as writer:
        for row in rows:
            batch.append(row)
            count += 1
            if len(batch) >= BATCH:
                writer.write_table(pa.Table.from_pylist(batch, SCHEMA))
                batch.clear()
                print(f"  {count:,} articles lus", flush=True)
            if limit is not None and count >= limit:
                break
        if batch:
            writer.write_table(pa.Table.from_pylist(batch, SCHEMA))
    return count


def run(limit: int | None = None) -> None:
    out = paths.WORK / "articles.parquet"
    print(f"parse : XML multistream -> {out}" + (f" (échantillon de {limit})" if limit else ""))
    # bz2.open lit les flux concaténés du multistream. En mode échantillon on lit le début du
    # fichier en flux HTTP et on s'arrête dès qu'on a assez d'articles.
    with open_dump("pages-articles-multistream.xml.bz2") as raw, bz2.open(raw, "rb") as stream:
        try:
            n = write_parquet(iter_articles(stream), out, limit)
        except EOFError:
            raise SystemExit("XML tronqué : relance `download`.") from None
    print(f"parse : {n:,} articles écrits dans {out}")
