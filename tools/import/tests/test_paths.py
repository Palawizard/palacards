"""Chemins de données : PALACARDS_DATA, .env, et chemins avec apostrophe dans le SQL DuckDB."""

import gzip
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from palacards_import import cli, paths
from palacards_import.build_cards import build
from palacards_import.props import max_page_id
from palacards_import.views import merge_months


@pytest.fixture
def quoted_dir(tmp_path: Path) -> Path:
    d = tmp_path / "C'est l'été" / "données d'O'Neil"
    d.mkdir(parents=True)
    return d


def test_sql_str_doubles_apostrophes():
    assert paths.sql_str("a'b") == "'a''b'"
    assert paths.sql_str(Path("/x/O'Neil/y.parquet")) == "'/x/O''Neil/y.parquet'"
    assert duckdb.sql(f"SELECT {paths.sql_str(chr(39) * 3)}").fetchone()[0] == "'''"


def write_articles(path: Path, n: int) -> None:
    ids = list(range(1, n + 1))
    pq.write_table(
        pa.table(
            {
                "page_id": pa.array(ids, pa.int64()),
                "title": [f"L'article {i}" for i in ids],
                "page_len": pa.array([i * 10 for i in ids], pa.int32()),
                "refs": pa.array([i % 5 for i in ids], pa.int32()),
                "sections": pa.array([i % 7 for i in ids], pa.int32()),
                "images": pa.array([i % 3 for i in ids], pa.int32()),
                "links": pa.array([i % 11 for i in ids], pa.int32()),
            }
        ),
        path,
    )


def test_pipeline_sql_with_apostrophe_in_paths(quoted_dir: Path):
    n = 300
    articles = quoted_dir / "articles.parquet"
    write_articles(articles, n)
    assert max_page_id(articles) == n

    months = []
    for m, factor in (("202601", 1), ("202602", 2)):
        f = quoted_dir / f"views-{m}.parquet"
        ids = list(range(1, n + 1))
        pq.write_table(
            pa.table(
                {
                    "page_id": pa.array(ids, pa.int64()),
                    "views": pa.array([factor * (n - i) for i in ids], pa.int64()),
                }
            ),
            f,
        )
        months.append(f)
    views = quoted_dir / "views.parquet"
    merge_months(months, views)
    assert duckdb.sql(f"SELECT sum(views) FROM read_parquet({paths.sql_str(views)})").fetchone()[
        0
    ] == 3 * sum(range(n))

    flags = quoted_dir / "flags.parquet"
    pq.write_table(
        pa.table(
            {
                "page_id": pa.array([5], pa.int64()),
                "disambiguation": [True],
                "featured": [False],
                "good": [False],
            }
        ),
        flags,
    )
    out = quoted_dir / "cards'sample.csv.gz"
    counts = build(
        duckdb.connect(), articles.as_posix(), views.as_posix(), flags.as_posix(), out.as_posix(), sample=True
    )
    assert sum(counts.values()) == n - 1
    with gzip.open(out, "rt", encoding="utf-8") as f:
        assert f.readline().strip() == "id,title,rarity,atk,def,views_12m,page_len"


@pytest.fixture
def restore_paths():
    saved = (paths.DATA, paths.RAW, paths.WORK, paths.OUT)
    yield
    paths.DATA, paths.RAW, paths.WORK, paths.OUT = saved


def test_palacards_data_env(monkeypatch, tmp_path: Path, restore_paths):
    monkeypatch.setenv(paths.DATA_ENV, str(tmp_path / "ailleurs"))
    paths.configure()
    assert paths.DATA == (tmp_path / "ailleurs").resolve()
    assert (
        paths.WORK == paths.DATA / "work"
        and paths.RAW == paths.DATA / "raw"
        and paths.OUT == paths.DATA / "out"
    )
    paths.ensure_dirs()
    assert paths.OUT.is_dir()
    paths.use_sample_dirs()
    assert paths.WORK == paths.DATA / "sample" and paths.WORK.is_dir()


def test_default_data_dir_in_source_checkout(monkeypatch, restore_paths):
    monkeypatch.delenv(paths.DATA_ENV, raising=False)
    paths.configure()
    assert paths.DATA == Path(__file__).resolve().parents[1] / "data"


def test_env_file_override_and_data_from_env_file(monkeypatch, tmp_path: Path, restore_paths):
    env = tmp_path / "prod.env"
    env.write_text(
        f"# commentaire\nPALACARDS_DATA={tmp_path / 'depuis-env'}\nWIKIMEDIA_USER_AGENT=Test/1 (a@b.c)\n",
        encoding="utf-8",
    )
    monkeypatch.setenv(cli.ENV_FILE_VAR, str(env))
    for var in (paths.DATA_ENV, "WIKIMEDIA_USER_AGENT"):  # setenv puis delenv : restaurées après le test
        monkeypatch.setenv(var, "x")
        monkeypatch.delenv(var)
    assert cli.find_env_file() == env
    cli.load_env()
    paths.configure()
    assert paths.DATA == (tmp_path / "depuis-env").resolve()


def test_env_file_override_missing(monkeypatch, tmp_path: Path):
    monkeypatch.setenv(cli.ENV_FILE_VAR, str(tmp_path / "absent.env"))
    with pytest.raises(SystemExit):
        cli.find_env_file()


def test_env_file_defaults_to_monorepo_root(monkeypatch):
    monkeypatch.delenv(cli.ENV_FILE_VAR, raising=False)
    root = Path(__file__).resolve().parents[3]
    found = cli.find_env_file()
    assert found == (root / ".env" if (root / ".env").is_file() else None)
