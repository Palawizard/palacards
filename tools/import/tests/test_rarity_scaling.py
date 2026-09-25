"""Les paliers de l'export (build_cards.scaled_ceilings) doivent égaler exactement les effectifs attendus
par finish_card_load (packages/db/migrations/0002_card_load.sql), sinon le chargement est refusé
(« effectif incohérent : 57 cartes …, 56 attendues »)."""

import os
import random
import shutil
import subprocess
from fractions import Fraction
from math import floor
from pathlib import Path

import duckdb
import pytest

from palacards_import.build_cards import FULL_POOL_SIZE, RANK_CEILINGS, SCALE_BELOW, scaled_ceilings

MIGRATION = Path(__file__).resolve().parents[3] / "packages" / "db" / "migrations" / "0002_card_load.sql"
TIERS = ["L", "UR", "SR", "R", "PC"]
# Expression du contrôle, telle qu'écrite dans la migration (vérifié ci-dessous).
SQL_SCALED = "greatest(1, floor(ceilings[i] * total / 2700000.0 + 0.5))"


def sql_expected(ceiling: int, total: int) -> int:
    """Transcription exacte (rationnels) du calcul de finish_card_load pour un palier."""
    expected = (
        ceiling
        if total >= 2_000_000
        else max(1, floor(Fraction(ceiling * total, 2_700_000) + Fraction(1, 2)))
    )
    return min(expected, total)


def cumulated_counts(ceilings: dict[str, int], total: int) -> list[int]:
    """Cartes de rareté <= palier produites par l'export (rang <= plafond), comme le contrôle SQL les compte."""
    return [min(ceilings[t], total) for t in TIERS]


def pool_sizes() -> list[int]:
    rng = random.Random(20260924)
    edges = [1, 2, 3, 26, 27, 28, 1349, 1350, 1351, 2699, 2700, 2701, 5400, 18_000, 20_000, 26_999, 27_000]
    edges += [1_999_998, 1_999_999, 2_000_000, 2_000_001, 2_700_000, 3_000_000]
    # Effectifs qui tombent pile sur un demi (c·t/2,7 M = n + 0,5) ou juste à côté.
    for c in RANK_CEILINGS.values():
        for k in range(1, 40):
            t = (2 * k + 1) * FULL_POOL_SIZE // (2 * c)
            edges += [t - 1, t, t + 1]
    return sorted(
        {t for t in edges + list(range(1, 2_000_000, 997)) + rng.sample(range(1, 2_000_000), 5_000) if t > 0}
    )


def test_migration_formula_is_the_transcribed_one():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert SQL_SCALED in sql
    assert "CASE WHEN total >= 2000000 THEN ceilings[i]" in sql
    assert "least(expected, total)" in sql
    assert f"ARRAY[{', '.join(str(v) for v in RANK_CEILINGS.values())}]" in sql
    assert SCALE_BELOW == 2_000_000 and FULL_POOL_SIZE == 2_700_000


def test_scaled_ceilings_match_sql_formula():
    for total in pool_sizes():
        ceilings = scaled_ceilings(total)
        expected = [sql_expected(RANK_CEILINGS[t], total) for t in TIERS]
        assert cumulated_counts(ceilings, total) == expected, total


def test_regression_float_rounding():
    # Pool où l'ancien calcul flottant (int(c * t / 2,7 M + 0,5)) donnait une carte de trop ou de moins.
    def old(c: int, t: int) -> int:
        return max(1, int(c * (t / FULL_POOL_SIZE) + 0.5))

    diverging = [
        t
        for t in pool_sizes()
        if t < SCALE_BELOW and any(old(c, t) != sql_expected(c, t) for c in RANK_CEILINGS.values())
    ]
    assert 405 in diverging  # SR : 7 par le flottant, 8 attendues
    assert diverging, "le jeu d'effectifs doit contenir des cas où le flottant divergeait"
    for t in diverging:
        assert cumulated_counts(scaled_ceilings(t), t) == [sql_expected(RANK_CEILINGS[x], t) for x in TIERS]


def test_duckdb_evaluation_of_sql_expression_all_sample_sizes():
    """Toutes les tailles d'échantillon (1 à 1 999 999) : l'expression SQL évaluée par DuckDB
    (double, suffisant ici : on n'est jamais à moins de 1/2,7 M d'un demi) égale la formule entière."""
    con = duckdb.connect()
    mismatches = con.execute(
        f"""
        WITH c(ceiling) AS (VALUES {", ".join(f"({v})" for v in RANK_CEILINGS.values())}),
             t(total) AS (SELECT range FROM range(1, {SCALE_BELOW}))
        SELECT count(*) FROM c, t
        WHERE greatest(1, floor(ceiling::INTEGER * total::BIGINT / 2700000.0 + 0.5))::BIGINT
           <> greatest(1, (2 * ceiling::BIGINT * total + 2700000) // 5400000)
        """
    ).fetchone()[0]
    assert mismatches == 0
    for total in random.Random(1).sample(range(1, SCALE_BELOW), 200):
        rows = con.execute(
            "SELECT greatest(1, floor(c::INTEGER * ?::BIGINT / 2700000.0 + 0.5))::BIGINT FROM unnest(?) AS u(c)",
            [total, list(RANK_CEILINGS.values())],
        ).fetchall()
        assert [r[0] for r in rows] == [scaled_ceilings(total)[x] for x in TIERS]


def _psql_url() -> str | None:
    url = os.environ.get("PALACARDS_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    return url if url and shutil.which("psql") else None


@pytest.mark.skipif(_psql_url() is None, reason="Postgres non disponible (DATABASE_URL + psql)")
def test_postgres_numeric_evaluation_all_sample_sizes():
    """Même vérification dans Postgres (numeric exact, types de la fonction plpgsql : int[] × bigint)."""
    query = f"""
        SELECT count(*) FROM unnest(ARRAY[{", ".join(str(v) for v in RANK_CEILINGS.values())}]::int[]) AS c(ceiling),
               generate_series(1::bigint, {SCALE_BELOW - 1}::bigint) AS t(total)
        WHERE greatest(1, floor(ceiling * total / 2700000.0 + 0.5))::bigint
           <> greatest(1, (2 * ceiling::bigint * total + 2700000) / 5400000)
    """
    try:
        out = subprocess.run(
            ["psql", _psql_url(), "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", query],
            capture_output=True,
            text=True,
            timeout=300,
            check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        pytest.skip(f"Postgres injoignable : {e}")
    assert out == "0"
