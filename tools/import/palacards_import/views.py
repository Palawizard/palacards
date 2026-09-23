"""Étape 3 : vues humaines (agent `user`) du Wikipédia FR sur les derniers mois complets.

Source : https://dumps.wikimedia.org/other/pageview_complete/monthly/ (≈ 5 Go par mois, un seul
flux bz2 trié par wiki puis par titre). On lit chaque mois en flux HTTP sans le stocker, on
s'arrête après le bloc `fr.wikipedia` (≈ 55 % du fichier) et on écrit `views-AAAAMM.parquet`.
Les redirections portent le page_id de leur cible : on somme donc par page_id.
Pas de somme de contrôle publiée pour ces fichiers : on vérifie que le flux bz2 est sain
jusqu'à la fin du bloc lu. Un mois interrompu est simplement relu depuis le début.
"""

from __future__ import annotations

import bz2
import datetime as dt
from collections import defaultdict
from collections.abc import Iterable, Iterator

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from . import paths
from .download import session

BASE = "https://dumps.wikimedia.org/other/pageview_complete/monthly"
WIKI = b"fr.wikipedia"
CHUNK = 1 << 20


def last_complete_months(today: dt.date, count: int) -> list[str]:
    """Les `count` mois complets précédant `today`, du plus ancien au plus récent (AAAAMM)."""
    months = []
    year, month = today.year, today.month
    for _ in range(count):
        month -= 1
        if month == 0:
            year, month = year - 1, 12
        months.append(f"{year:04d}{month:02d}")
    return months[::-1]


def month_url(month: str) -> str:
    return f"{BASE}/{month[:4]}/{month[:4]}-{month[4:]}/pageviews-{month}-user.bz2"


def iter_lines(chunks: Iterable[bytes]) -> Iterator[bytes]:
    """Lignes décompressées d'un flux bz2, sans découper le texte avant le bloc fr.wikipedia."""
    decomp = bz2.BZ2Decompressor()
    tail = b""
    reached = False
    for chunk in chunks:
        data = tail + decomp.decompress(chunk)
        if not reached:
            pos = data.find(b"\n" + WIKI + b" ")
            if pos < 0:
                # Garde la fin (ligne peut-être coupée) et continue sans découper.
                tail = data[-200:]
                continue
            reached = True
            data = data[pos + 1 :]
        lines = data.split(b"\n")
        tail = lines.pop()
        yield from lines
    if tail:
        yield tail


def aggregate(lines: Iterable[bytes]) -> dict[int, int]:
    """Somme des vues par page_id pour fr.wikipedia ; s'arrête à la fin du bloc."""
    totals: dict[int, int] = defaultdict(int)
    started = False
    for line in lines:
        parts = line.split(b" ")
        if parts[0] != WIKI:
            if started and parts[0] > WIKI:
                break
            continue
        started = True
        if len(parts) < 5 or parts[2] == b"null":
            continue
        try:
            totals[int(parts[2])] += int(parts[4])
        except ValueError:
            continue
    return totals


def progress(chunks: Iterable[bytes], size: int, label: str) -> Iterator[bytes]:
    """Affiche l'avancement de la lecture (le bloc fr.wikipedia finit vers 55 % du fichier)."""
    read = 0
    step = 256 * CHUNK
    for chunk in chunks:
        read += len(chunk)
        if read // step != (read - len(chunk)) // step:
            print(f"  {label} : {read / size:6.1%} lus", flush=True)
        yield chunk


def write_month(month: str, totals: dict[int, int]) -> None:
    out = paths.WORK / f"views-{month}.parquet"
    table = pa.table({"page_id": pa.array(list(totals), pa.int64()), "views": pa.array(list(totals.values()), pa.int64())})
    tmp = out.with_suffix(".tmp")
    pq.write_table(table, tmp)
    tmp.replace(out)


def run(months: int = 12, today: dt.date | None = None) -> None:
    http = session()
    wanted = last_complete_months(today or dt.date.today(), months + 1)
    # Le dernier mois n'est parfois pas encore publié : on décale alors la fenêtre d'un mois.
    if http.head(month_url(wanted[-1]), timeout=30).status_code != 200:
        wanted = wanted[:-1]
    wanted = wanted[-months:]
    print(f"views : mois {wanted[0]} à {wanted[-1]}")
    for month in wanted:
        out = paths.WORK / f"views-{month}.parquet"
        if out.exists():
            print(f"  {month} déjà agrégé")
            continue
        print(f"  {month} : lecture en flux de {month_url(month)}")
        with http.get(month_url(month), stream=True, timeout=120) as r:
            r.raise_for_status()
            size = int(r.headers.get("Content-Length", 0)) or 1
            totals = aggregate(iter_lines(progress(r.iter_content(CHUNK), size, month)))
        if not totals:
            raise SystemExit(f"Aucune ligne fr.wikipedia dans {month_url(month)}")
        write_month(month, totals)
        print(f"  {month} : {len(totals):,} pages")
    files = [(paths.WORK / f"views-{m}.parquet").as_posix() for m in wanted]
    duckdb.sql(
        f"COPY (SELECT page_id, sum(views)::BIGINT AS views FROM read_parquet({files}) GROUP BY page_id) "
        f"TO '{(paths.WORK / 'views.parquet').as_posix()}' (FORMAT parquet)"
    )
    print(f"views : {paths.WORK / 'views.parquet'} écrit ({len(wanted)} mois)")
