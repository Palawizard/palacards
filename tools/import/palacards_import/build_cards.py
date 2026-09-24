"""Étape 4 : joint articles, vues et labels, calcule rareté, ATK et DEF, exporte le CSV des cartes.

Règles (docs/05-cartes.md) :
- rareté = rang en vues sur 12 mois (1 = le plus lu), paliers de `packages/game/src/rarity.ts` ;
- ATK = 100 + floor(9899 × pct(page_len)) ;
- Q = 0,35·pct(refs) + 0,25·pct(sections) + 0,2·pct(images) + 0,2·pct(liens)
  DEF = min(9999, 100 + floor(9899 × pct(Q)) + bonus), bonus +1500 AdQ, +800 BA.
Sous 2 M articles (échantillon), les paliers sont mis à l'échelle du pool (mêmes proportions),
exactement comme le contrôle du chargement (finish_card_load).
"""

from __future__ import annotations

import duckdb

from . import paths
from .paths import sql_str

# Doit rester identique à RARITY_RANK_CEILING dans packages/game/src/rarity.ts (vérifié par les tests).
RANK_CEILINGS = {"L": 1_000, "UR": 10_000, "SR": 50_000, "R": 250_000, "PC": 1_000_000}
# Taille de référence du pool complet (~2,7 M articles) pour la mise à l'échelle des échantillons.
FULL_POOL_SIZE = 2_700_000
# En dessous, les paliers sont mis à l'échelle (même seuil que finish_card_load, migration 0002).
SCALE_BELOW = 2_000_000
FEATURED_BONUS = 1_500
GOOD_BONUS = 800
CSV_COLUMNS = ["id", "title", "rarity", "atk", "def", "views_12m", "page_len"]


def scaled_ceilings(pool_size: int) -> dict[str, int]:
    """Rang plafond de chaque palier, transcription exacte du contrôle de finish_card_load
    (packages/db/migrations/0002_card_load.sql) :

        expected := CASE WHEN total >= 2000000 THEN ceiling
                         ELSE greatest(1, floor(ceiling * total / 2700000.0 + 0.5)) END;

    En arithmétique entière (pas de flottant : `int(c * ratio + 0.5)` divergeait d'une carte sur
    certains effectifs et le chargement était refusé) : floor(c·t/2,7 M + 1/2) = (2·c·t + 2,7 M) // 5,4 M.
    Le `least(expected, total)` du SQL est implicite : un plafond au-delà du pool couvre tout le pool.
    """
    if pool_size >= SCALE_BELOW:
        return dict(RANK_CEILINGS)
    return {
        r: max(1, (2 * c * pool_size + FULL_POOL_SIZE) // (2 * FULL_POOL_SIZE)) for r, c in RANK_CEILINGS.items()
    }


def rarity_case(ceilings: dict[str, int]) -> str:
    whens = " ".join(f"WHEN rank <= {ceilings[r]} THEN '{r}'" for r in ["L", "UR", "SR", "R", "PC"])
    return f"CASE {whens} ELSE 'C' END"


def build(
    con: duckdb.DuckDBPyConnection, articles: str, views: str, flags: str, out: str, sample: bool
) -> dict[str, int]:
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE pool AS
        SELECT a.*, coalesce(v.views, 0) AS views_12m,
               coalesce(f.featured, false) AS featured, coalesce(f.good, false) AS good
        FROM read_parquet({sql_str(articles)}) a
        LEFT JOIN read_parquet({sql_str(views)}) v USING (page_id)
        LEFT JOIN read_parquet({sql_str(flags)}) f USING (page_id)
        WHERE NOT coalesce(f.disambiguation, false)
        """
    )
    pool_size = con.execute("SELECT count(*) FROM pool").fetchone()[0]
    if pool_size == 0:
        raise SystemExit("Aucun article à exporter")
    ceilings = scaled_ceilings(pool_size)
    scaled = pool_size < SCALE_BELOW
    if sample != scaled:
        # Le chargement décide sur l'effectif, pas sur le mode : on suit la même règle.
        mode = "mis à l'échelle" if scaled else "complets"
        print(f"  attention : {pool_size:,} articles, paliers {mode} (règle de finish_card_load)")
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE scored AS
        WITH ranked AS (
            SELECT *,
                   row_number() OVER (ORDER BY views_12m DESC, page_id) AS rank,
                   percent_rank() OVER (ORDER BY page_len) AS p_len,
                   0.35 * percent_rank() OVER (ORDER BY refs)
                 + 0.25 * percent_rank() OVER (ORDER BY sections)
                 + 0.20 * percent_rank() OVER (ORDER BY images)
                 + 0.20 * percent_rank() OVER (ORDER BY links) AS q
            FROM pool
        )
        SELECT page_id AS id, title, {rarity_case(ceilings)} AS rarity,
               (100 + floor(9899 * p_len))::INTEGER AS atk,
               least(9999, 100 + floor(9899 * percent_rank() OVER (ORDER BY q))
                     + CASE WHEN featured THEN {FEATURED_BONUS} WHEN good THEN {GOOD_BONUS} ELSE 0 END)::INTEGER AS def,
               views_12m, page_len
        FROM ranked
        """
    )
    con.execute(f"COPY (SELECT {', '.join(CSV_COLUMNS)} FROM scored ORDER BY id) TO {sql_str(out)} (HEADER, DELIMITER ',')")
    return dict(con.execute("SELECT rarity, count(*) FROM scored GROUP BY rarity").fetchall())


def run(sample: bool = False) -> None:
    out = paths.OUT / ("cards-sample.csv.gz" if sample else "cards.csv.gz")
    counts = build(
        duckdb.connect(),
        (paths.WORK / "articles.parquet").as_posix(),
        (paths.WORK / "views.parquet").as_posix(),
        (paths.WORK / "flags.parquet").as_posix(),
        out.as_posix(),
        sample,
    )
    total = sum(counts.values())
    print(f"build : {total:,} cartes -> {out}")
    for r in ["L", "UR", "SR", "R", "PC", "C"]:
        print(f"  {r:>2} : {counts.get(r, 0):>9,}")
