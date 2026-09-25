"""Étape 4 : joint articles, vues et labels, calcule rareté, ATK et DEF, exporte le CSV des cartes.

Règles (docs/05-cartes.md) :
- rareté = rang en vues sur 12 mois (1 = le plus lu), paliers de `packages/game/src/rarity.ts` ;
- chaque rareté a une fourchette de stats (STAT_BANDS, chevauchantes) : une PC ne peut pas avoir les
  stats d'une L, mais une très bonne C bat une R moyenne. Le rang se fait DANS la rareté :
    stat = bas + floor((haut − bas) × pct_rareté(critère))
- ATK : critère = prose_len, la longueur du texte lisible (sans modèles, tableaux, références ni
  infobox : le wikicode brut gonflait les communes et autres articles générés) ;
- DEF : critère = densité de qualité, indépendante de la taille : chaque critère est rapporté à la
  taille en Ko, lissée par DENSITY_SMOOTHING_KB pour qu'une ébauche de 3 lignes avec une source ne
  soit pas « parfaite »,
    d(x) = x / (page_len / 1000 + DENSITY_SMOOTHING_KB)
    Q = 0,55·pct(d(refs)) + 0,20·pct(d(images)) + 0,15·pct(d(sections)) + 0,10·pct(d(liens))
  puis bonus +1500 AdQ, +800 BA (peut dépasser le haut de la fourchette), plafond 9999.
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
# Ko ajoutés à la taille pour calculer les densités (lissage des très petits articles).
DENSITY_SMOOTHING_KB = 5.0
GOOD_BONUS = 800
# Fourchettes (bas, haut) d'ATK et de DEF par rareté. Chevauchantes exprès : la rareté pèse, sans
# rendre une carte d'un palier inférieur toujours perdante.
STAT_BANDS = {
    "C": (100, 5_000),
    "PC": (1_000, 6_500),
    "R": (2_500, 7_500),
    "SR": (4_000, 8_500),
    "UR": (5_500, 9_300),
    "L": (7_000, 9_999),
}
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
        r: max(1, (2 * c * pool_size + FULL_POOL_SIZE) // (2 * FULL_POOL_SIZE))
        for r, c in RANK_CEILINGS.items()
    }


def rarity_case(ceilings: dict[str, int]) -> str:
    whens = " ".join(f"WHEN rank <= {ceilings[r]} THEN '{r}'" for r in ["L", "UR", "SR", "R", "PC"])
    return f"CASE {whens} ELSE 'C' END"


def band_case(index: int) -> str:
    whens = " ".join(f"WHEN '{r}' THEN {b[index]}" for r, b in STAT_BANDS.items())
    return f"CASE rarity {whens} END"


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
    columns = {row[0] for row in con.execute("DESCRIBE pool").fetchall()}
    if "prose_len" not in columns:
        raise SystemExit(
            "articles.parquet date d'avant la mesure de la prose : relance `palacards-import parse`."
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
                   0.55 * percent_rank() OVER (ORDER BY refs / kb)
                 + 0.20 * percent_rank() OVER (ORDER BY images / kb)
                 + 0.15 * percent_rank() OVER (ORDER BY sections / kb)
                 + 0.10 * percent_rank() OVER (ORDER BY links / kb) AS q
            FROM (SELECT *, page_len / 1000.0 + {DENSITY_SMOOTHING_KB} AS kb FROM pool)
        ),
        rated AS (SELECT *, {rarity_case(ceilings)} AS rarity FROM ranked),
        banded AS (
            SELECT *,
                   percent_rank() OVER (PARTITION BY rarity ORDER BY prose_len) AS p_len,
                   percent_rank() OVER (PARTITION BY rarity ORDER BY q) AS p_q,
                   {band_case(0)} AS lo, {band_case(1)} AS hi
            FROM rated
        )
        SELECT page_id AS id, title, rarity,
               (lo + floor((hi - lo) * p_len))::INTEGER AS atk,
               least(9999, lo + floor((hi - lo) * p_q)
                     + CASE WHEN featured THEN {FEATURED_BONUS} WHEN good THEN {GOOD_BONUS} ELSE 0 END)::INTEGER AS def,
               views_12m, page_len
        FROM banded
        """
    )
    con.execute(
        f"COPY (SELECT {', '.join(CSV_COLUMNS)} FROM scored ORDER BY id) TO {sql_str(out)} (HEADER, DELIMITER ',')"
    )
    corr = con.execute("SELECT corr(atk, def) FROM scored").fetchone()[0]
    print(f"  corrélation ATK/DEF : {corr:.2f}" if corr is not None else "  corrélation ATK/DEF : n/a")
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
