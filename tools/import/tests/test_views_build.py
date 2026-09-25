import bz2
import csv
import datetime as dt
import gzip
import re
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from palacards_import.build_cards import RANK_CEILINGS, build, scaled_ceilings
from palacards_import.views import aggregate, iter_lines, last_complete_months

PAGEVIEWS = b"""de.wikipedia Paris 1 desktop 99 A99
en.wikipedia Paris 22989 desktop 5000 A5000
fr.wikibooks Paris 3 desktop 7 A7
fr.wikipedia Honeypot 134682 desktop 213 A3B5
fr.wikipedia Honeypot 134682 mobile-web 146 A3B3
fr.wikipedia Identification_(Psychologie) 420086 desktop 2 C1Y1
fr.wikipedia Identification_(psychanalyse) 420086 desktop 70 A1B2
fr.wikipedia Page_supprimee null desktop 12 A12
fr.wikipedia Ligne_courte 7 desktop 5
fr.wikiquote Paris 9 desktop 1000 A1000
"""


def chunks(data: bytes, size: int):
    for i in range(0, len(data), size):
        yield data[i : i + size]


def test_last_complete_months():
    assert last_complete_months(dt.date(2026, 2, 15), 3) == ["202511", "202512", "202601"]


def test_aggregate_fr_block_sums_by_page_id():
    for size in (7, 50, 10_000):  # coupures de flux arbitraires
        totals = aggregate(iter_lines(chunks(bz2.compress(PAGEVIEWS), size)))
        assert totals == {134682: 359, 420086: 72, 7: 5}


RARITY_TS = Path(__file__).resolve().parents[3] / "packages" / "game" / "src" / "rarity.ts"


def test_rank_ceilings_match_packages_game():
    ts = RARITY_TS.read_text(encoding="utf-8")
    block = ts.split("RARITY_RANK_CEILING")[1].split("};")[0]
    found = {k: int(v.replace("_", "")) for k, v in re.findall(r"(\w+): ([\d_]+)", block)}
    assert found == RANK_CEILINGS


def test_scaled_ceilings_keep_proportions():
    assert scaled_ceilings(2_700_000) == RANK_CEILINGS
    assert scaled_ceilings(2_000_000) == RANK_CEILINGS  # seuil de finish_card_load
    assert scaled_ceilings(27_000) == {"L": 10, "UR": 100, "SR": 500, "R": 2_500, "PC": 10_000}
    assert scaled_ceilings(10) == {"L": 1, "UR": 1, "SR": 1, "R": 1, "PC": 4}


def test_build_rarity_stats_and_bonus(tmp_path):
    n = 2_700  # échantillon : 1 L, 10 UR, 50 SR, 250 R, 1000 PC, le reste C
    ids = list(range(1, n + 1))
    articles = tmp_path / "articles.parquet"
    pq.write_table(
        pa.table(
            {
                "page_id": pa.array(ids, pa.int64()),
                "title": [f"Article {i}" for i in ids],
                "page_len": pa.array([i * 10 for i in ids], pa.int32()),
                "refs": pa.array([i % 50 for i in ids], pa.int32()),
                "sections": pa.array([i % 7 for i in ids], pa.int32()),
                "images": pa.array([i % 3 for i in ids], pa.int32()),
                "links": pa.array([i % 100 for i in ids], pa.int32()),
            }
        ),
        articles,
    )
    views = tmp_path / "views.parquet"
    # page i a n - i vues : la page 1 est la plus lue ; la page 2 est une homonymie.
    pq.write_table(
        pa.table({"page_id": pa.array(ids, pa.int64()), "views": pa.array([n - i for i in ids], pa.int64())}),
        views,
    )
    flags = tmp_path / "flags.parquet"
    pq.write_table(
        pa.table(
            {
                "page_id": pa.array([2, 3, 4], pa.int64()),
                "disambiguation": [True, False, False],
                "featured": [False, True, False],
                "good": [False, False, True],
            }
        ),
        flags,
    )
    out = tmp_path / "cards.csv.gz"
    counts = build(
        duckdb.connect(), articles.as_posix(), views.as_posix(), flags.as_posix(), out.as_posix(), sample=True
    )
    assert sum(counts.values()) == n - 1
    assert counts["L"] == 1 and counts["UR"] == 9 and counts["SR"] == 40

    with gzip.open(out, "rt", encoding="utf-8") as f:
        rows = {int(r["id"]): r for r in csv.DictReader(f)}
    assert 2 not in rows
    assert rows[1]["rarity"] == "L"
    assert rows[n]["rarity"] == "C"
    assert all(100 <= int(r["atk"]) <= 9999 and 100 <= int(r["def"]) <= 9999 for r in rows.values())
    assert int(rows[n]["atk"]) == 9999  # article le plus long
    assert int(rows[1]["atk"]) == 100

    # Bonus AdQ / BA : même article sans label -> DEF plus basse de 1500 / 800 (au plafond près).
    flags_off = tmp_path / "flags-off.parquet"
    pq.write_table(
        pa.table(
            {
                "page_id": pa.array([2, 3, 4], pa.int64()),
                "disambiguation": [True, False, False],
                "featured": [False, False, False],
                "good": [False, False, False],
            }
        ),
        flags_off,
    )
    out_off = tmp_path / "cards-off.csv.gz"
    build(
        duckdb.connect(),
        articles.as_posix(),
        views.as_posix(),
        flags_off.as_posix(),
        out_off.as_posix(),
        sample=True,
    )
    with gzip.open(out_off, "rt", encoding="utf-8") as f:
        off = {int(r["id"]): int(r["def"]) for r in csv.DictReader(f)}
    assert int(rows[3]["def"]) == min(9_999, off[3] + 1_500)
    assert int(rows[4]["def"]) == min(9_999, off[4] + 800)


def write_pool(tmp_path, arts: list[tuple[int, int, int, int, int, int]]):
    """arts : (page_id, page_len, refs, sections, images, links) ; vues décroissantes par page_id."""
    articles = tmp_path / "articles.parquet"
    cols = list(zip(*arts))
    pq.write_table(
        pa.table(
            {
                "page_id": pa.array(cols[0], pa.int64()),
                "title": [f"Article {i}" for i in cols[0]],
                "page_len": pa.array(cols[1], pa.int32()),
                "refs": pa.array(cols[2], pa.int32()),
                "sections": pa.array(cols[3], pa.int32()),
                "images": pa.array(cols[4], pa.int32()),
                "links": pa.array(cols[5], pa.int32()),
            }
        ),
        articles,
    )
    views = tmp_path / "views.parquet"
    pq.write_table(
        pa.table(
            {
                "page_id": pa.array(cols[0], pa.int64()),
                "views": pa.array([10_000 - i for i in cols[0]], pa.int64()),
            }
        ),
        views,
    )
    flags = tmp_path / "flags.parquet"
    pq.write_table(
        pa.table(
            {
                "page_id": pa.array([], pa.int64()),
                "disambiguation": pa.array([], pa.bool_()),
                "featured": pa.array([], pa.bool_()),
                "good": pa.array([], pa.bool_()),
            }
        ),
        flags,
    )
    out = tmp_path / "cards.csv.gz"
    build(
        duckdb.connect(), articles.as_posix(), views.as_posix(), flags.as_posix(), out.as_posix(), sample=True
    )
    with gzip.open(out, "rt", encoding="utf-8") as f:
        return {int(r["id"]): r for r in csv.DictReader(f)}


def test_def_is_quality_density_not_size(tmp_path):
    # 1 : article énorme mais peu sourcé ; 2 : article moyen très sourcé ; 3 : ébauche avec 1 source.
    arts = [
        (1, 200_000, 20, 10, 2, 300),
        (2, 20_000, 120, 12, 10, 150),
        (3, 800, 1, 1, 0, 5),
    ] + [(i, 5_000 + i * 37, i % 13, i % 6, i % 4, i % 40) for i in range(4, 400)]
    rows = write_pool(tmp_path, arts)
    atk = {i: int(rows[i]["atk"]) for i in (1, 2, 3)}
    dfn = {i: int(rows[i]["def"]) for i in (1, 2, 3)}
    assert atk[1] > atk[2] > atk[3]  # ATK = taille
    assert dfn[2] > dfn[1]  # plus sourcé à taille égale ou moindre : meilleure défense
    assert dfn[1] < 5_000  # la taille seule ne donne plus une DEF maximale
    assert dfn[3] < dfn[2]  # le lissage empêche une ébauche d'être « parfaite »
