"""Construit l'index local d'une saison (DuckDB) : cartes, arbre des catégories, données Wikidata.

Une fois par saison (choix de Palawi, 2026-11-04) : ~15 à 25 min, sans aucune requête à l'API Wikipédia.
"""

from __future__ import annotations

import time

import duckdb

from . import dumps, paths, prod, wikidata

RARITIES = ["C", "PC", "R", "SR", "UR", "L"]


def connect(path=None, read_only: bool = True) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(str(path or paths.current_index()), read_only=read_only)
    con.execute("SET memory_limit = '4GB'; SET threads = 4;")
    con.execute(f"SET temp_directory = '{paths.DATA / 'tmp'}'")
    return con


def _tsv(name: str, columns: dict[str, str]) -> str:
    cols = ", ".join(f"'{k}': '{v}'" for k, v in columns.items())
    return (
        f"read_csv('{paths.RAW / name}', delim='\\t', header=false, quote='', escape='', "
        f"columns={{{cols}}}, ignore_errors=true)"
    )


def build(season: int | None = None, download: bool = True, wikidata_fetch: bool = True) -> None:
    start = time.time()
    season = season or prod.active_season()
    print(f"Index de la saison {season}")
    if download:
        print("1/4 Dumps du Wikipédia FR")
        dumps.download()
        print("2/4 Analyse des dumps")
        dumps.parse()
    if wikidata_fetch:
        print("3/4 Wikidata (QLever)")
        wikidata.fetch_all()
    print("4/4 Cartes de la saison et base DuckDB")
    prod.export_cards(season)
    dest = paths.index_db(season)
    tmp = dest.with_suffix(".building")
    tmp.unlink(missing_ok=True)
    (paths.DATA / "tmp").mkdir(parents=True, exist_ok=True)
    con = connect(tmp, read_only=False)
    rank = " ".join(f"WHEN '{r}' THEN {i}" for i, r in enumerate(RARITIES))
    con.execute(f"""
        CREATE TABLE cards AS
        SELECT id, title, rarity, CASE rarity {rank} END::TINYINT AS r, views
        FROM read_csv('{paths.RAW / 'cards.csv'}', header=false, delim=',', quote='"', escape='"',
                      columns={{'id': 'BIGINT', 'title': 'VARCHAR', 'rarity': 'VARCHAR', 'views': 'BIGINT'}});
        CREATE TABLE cat AS SELECT * FROM {_tsv('cat_pages.tsv', {'id': 'BIGINT', 'title': 'VARCHAR'})};
        CREATE TABLE lt AS SELECT * FROM {_tsv('linktarget.tsv', {'lt_id': 'BIGINT', 'title': 'VARCHAR'})};
        CREATE TABLE cat_edge AS
        SELECT DISTINCT c.title AS child, l.title AS parent
        FROM {_tsv('cl_subcats.tsv', {'src': 'BIGINT', 'lt_id': 'BIGINT'})} s
        JOIN cat c ON c.id = s.src JOIN lt l ON l.lt_id = s.lt_id;
        CREATE TABLE cat_member AS
        SELECT DISTINCT s.src AS page_id, l.title AS cat
        FROM {_tsv('cl_pages.tsv', {'src': 'BIGINT', 'lt_id': 'BIGINT'})} s
        JOIN lt l ON l.lt_id = s.lt_id
        WHERE s.src IN (SELECT id FROM cards);
        CREATE TABLE qid AS
        SELECT DISTINCT q.page_id, q.q FROM {_tsv('qids.tsv', {'page_id': 'BIGINT', 'q': 'BIGINT'})} q
        WHERE q.page_id IN (SELECT id FROM cards);
    """)
    for prop in wikidata.ITEM_PROPS:
        con.execute(f"""
            CREATE TABLE {prop.lower()} AS
            SELECT DISTINCT t.q, t.v FROM {_tsv(f'{prop}.tsv', {'q': 'BIGINT', 'v': 'BIGINT'})} t
            WHERE t.q IN (SELECT q FROM qid)
        """)
    con.execute(f"""
        CREATE TABLE p279 AS SELECT DISTINCT * FROM {_tsv('P279.tsv', {'c': 'BIGINT', 'p': 'BIGINT'})};
        CREATE TABLE descr AS
        SELECT q, any_value(text) AS text FROM {_tsv('desc.tsv', {'q': 'BIGINT', 'text': 'VARCHAR'})}
        WHERE q IN (SELECT q FROM qid) GROUP BY q;
        CREATE TABLE labels AS
        SELECT q, any_value(text) AS label FROM (
          SELECT * FROM {_tsv('labels_classes.tsv', {'q': 'BIGINT', 'text': 'VARCHAR'})}
          UNION ALL SELECT * FROM {_tsv('labels_values.tsv', {'q': 'BIGINT', 'text': 'VARCHAR'})}
        ) GROUP BY q;
        CREATE TABLE art AS
        SELECT c.id, c.title, c.rarity, c.r, c.views, q.q, d.text AS descr,
               EXISTS (SELECT 1 FROM p31 WHERE p31.q = q.q AND p31.v = 5) AS person
        FROM cards c LEFT JOIN (SELECT page_id, min(q) AS q FROM qid GROUP BY page_id) q ON q.page_id = c.id
        LEFT JOIN descr d ON d.q = q.q;
        CREATE INDEX cat_edge_parent ON cat_edge(parent);
        CREATE INDEX cat_member_cat ON cat_member(cat);
        CREATE TABLE meta AS SELECT * FROM (VALUES
          ('season', '{season}'), ('dump', '{dumps.dump_date()}'),
          ('built', strftime(now(), '%Y-%m-%d %H:%M'))) t(key, value);
    """)
    for table in ["cards", "cat_edge", "cat_member", "qid", "p31", "p279", "descr", "labels"]:
        print(f"  {table} : {con.execute(f'SELECT count(*) FROM {table}').fetchone()[0]:,}")
    con.close()
    tmp.rename(dest)
    print(f"Index prêt : {dest} ({time.time() - start:.0f} s)")
