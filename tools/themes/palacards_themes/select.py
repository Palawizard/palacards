"""Sélection des cartes d'une fiche dans l'index local (DuckDB), avec le détail de chaque étape."""

from __future__ import annotations

from dataclasses import dataclass, field

import duckdb

from .index import RARITIES
from .spec import CLASS_PROPS, Categories, Family, Spec


def _rx(patterns: list[str]) -> str:
    """Plusieurs motifs en une regex RE2 insensible à la casse."""
    return "(?i)" + "|".join(f"(?:{p})" for p in patterns)


def subclasses(con: duckdb.DuckDBPyConnection, qids: list[int]) -> list[int]:
    """Les classes et toutes leurs sous-classes (P279*), cycles compris."""
    if not qids:
        return []
    rows = con.execute(
        """WITH RECURSIVE sub(q) AS (
             SELECT unnest(?::BIGINT[])
             UNION SELECT p.c FROM p279 p JOIN sub ON p.p = sub.q)
           SELECT q FROM sub""",
        [qids],
    ).fetchall()
    return [r[0] for r in rows]


def category_tree(con: duckdb.DuckDBPyConnection, cats: list[Categories]) -> dict[str, int]:
    """Catégories et sous-catégories jusqu'à la profondeur demandée -> profondeur atteinte."""
    seen: dict[str, int] = {}
    for c in cats:
        rows = con.execute(
            """WITH RECURSIVE t(title, d) AS (
                 SELECT unnest(?::VARCHAR[]), 0
                 UNION SELECT e.child, t.d + 1 FROM t JOIN cat_edge e ON e.parent = t.title WHERE t.d < ?)
               SELECT title, min(d) FROM t GROUP BY title""",
            [c.names, c.depth],
        ).fetchall()
        for title, d in rows:
            seen[title] = min(d, seen.get(title, d))
    return seen


def _wikidata_ids(con, props: dict[str, list[int]], exact: bool) -> set[int]:
    ids: set[int] = set()
    for prop, values in props.items():
        targets = values if exact or prop not in CLASS_PROPS else subclasses(con, values)
        rows = con.execute(
            f"SELECT DISTINCT a.id FROM art a JOIN {prop.lower()} t ON t.q = a.q WHERE t.v IN (SELECT unnest(?::BIGINT[]))",
            [targets],
        ).fetchall()
        ids.update(r[0] for r in rows)
    return ids


def _category_ids(con, cats: list[Categories]) -> tuple[set[int], dict[str, int]]:
    tree = category_tree(con, cats)
    if not tree:
        return set(), {}
    rows = con.execute(
        "SELECT DISTINCT page_id FROM cat_member WHERE cat IN (SELECT unnest(?::VARCHAR[]))", [list(tree)]
    ).fetchall()
    return {r[0] for r in rows}, tree


def _ids_where(con, ids: set[int], where: str, params: list) -> set[int]:
    """Parmi `ids`, ceux de `art` qui vérifient `where`."""
    if not ids:
        return set()
    con.execute("CREATE OR REPLACE TEMP TABLE _ids AS SELECT unnest(?::BIGINT[]) AS id", [list(ids)])
    rows = con.execute(f"SELECT a.id FROM art a JOIN _ids USING (id) WHERE {where}", params).fetchall()
    return {r[0] for r in rows}


@dataclass
class FamilyResult:
    family: Family
    sources: dict[str, int] = field(default_factory=dict)
    dropped: dict[str, int] = field(default_factory=dict)
    ids: set[int] = field(default_factory=set)
    tree: dict[str, int] = field(default_factory=dict)
    missing_titles: list[str] = field(default_factory=list)
    missing_categories: list[str] = field(default_factory=list)


def _titles(con, titles: list[str]) -> tuple[set[int], list[str]]:
    if not titles:
        return set(), []
    rows = con.execute(
        "SELECT id, title FROM art WHERE title IN (SELECT unnest(?::VARCHAR[]))", [titles]
    ).fetchall()
    found = {t for _, t in rows}
    return {i for i, _ in rows}, [t for t in titles if t not in found]


def family(con: duckdb.DuckDBPyConnection, fam: Family) -> FamilyResult:
    res = FamilyResult(fam)
    ids: set[int] = set()
    if fam.wikidata:
        w = _wikidata_ids(con, fam.wikidata, fam.exact)
        res.sources["wikidata"] = len(w)
        ids |= w
    if fam.categories:
        c, res.tree = _category_ids(con, fam.categories)
        res.sources[f"catégories ({len(res.tree)})"] = len(c)
        known = {r[0] for r in con.execute(
            "SELECT DISTINCT parent FROM cat_edge WHERE parent IN (SELECT unnest(?::VARCHAR[])) "
            "UNION SELECT DISTINCT cat FROM cat_member WHERE cat IN (SELECT unnest(?::VARCHAR[]))",
            [[n for cs in fam.categories for n in cs.names]] * 2).fetchall()}
        res.missing_categories = [n for cs in fam.categories for n in cs.names if n not in known]
        ids |= c
    if fam.title_regex:
        rows = con.execute("SELECT id FROM art WHERE regexp_matches(title, ?)", [_rx(fam.title_regex)]).fetchall()
        res.sources["motifs de titre"] = len(rows)
        ids |= {r[0] for r in rows}
    if fam.titles:
        t, res.missing_titles = _titles(con, fam.titles)
        res.sources["titres"] = len(t)
        forced = t
    else:
        forced = set()
    ids |= forced

    def drop(label: str, where: str, params: list) -> None:
        nonlocal ids
        gone = _ids_where(con, ids - forced, where, params)
        if gone:
            res.dropped[label] = len(gone)
            ids -= gone

    rank = RARITIES.index(fam.min_rarity)
    if rank:
        drop(f"rareté < {fam.min_rarity}", "a.r < ?", [rank])
    if fam.people == "only":
        drop("pas une personne", "NOT a.person", [])
    elif fam.people == "none":
        drop("personne", "a.person", [])
    if fam.keep_desc:
        cond = "NOT coalesce(regexp_matches(a.descr, ?), false)"
        if fam.keep_no_desc:
            cond += " AND a.descr IS NOT NULL"
        drop("description hors sujet", cond, [_rx(fam.keep_desc)])
    if fam.drop_desc:
        drop("description exclue", "coalesce(regexp_matches(a.descr, ?), false)", [_rx(fam.drop_desc)])
    if fam.drop_title_regex:
        drop("titre exclu", "regexp_matches(a.title, ?)", [_rx(fam.drop_title_regex)])
    if fam.drop_wikidata:
        gone = _wikidata_ids(con, fam.drop_wikidata, fam.exact) & (ids - forced)
        if gone:
            res.dropped["classe exclue"] = len(gone)
            ids -= gone
    if fam.drop_categories:
        gone = _category_ids(con, fam.drop_categories)[0] & (ids - forced)
        if gone:
            res.dropped["catégorie exclue"] = len(gone)
            ids -= gone
    res.ids = ids
    return res


@dataclass
class Selection:
    families: list[FamilyResult]
    family_of: dict[int, str]
    excluded: dict[str, int]
    included: set[int]
    missing_include: list[str]
    ids: set[int]


def select(con: duckdb.DuckDBPyConnection, spec: Spec) -> Selection:
    results = [family(con, f) for f in spec.families]
    family_of: dict[int, str] = {}
    for r in results:
        for i in r.ids:
            family_of.setdefault(i, r.family.name)
    ids = set(family_of)
    excluded: dict[str, int] = {}

    def exclude(label: str, gone: set[int]) -> None:
        nonlocal ids
        gone &= ids
        if gone:
            excluded[label] = len(gone)
            ids -= gone

    if spec.exclude_titles:
        exclude("titres", _titles(con, spec.exclude_titles)[0])
    if spec.exclude_title_regex:
        exclude("motifs de titre", _ids_where(con, ids, "regexp_matches(a.title, ?)", [_rx(spec.exclude_title_regex)]))
    if spec.exclude_desc:
        exclude("descriptions", _ids_where(con, ids, "coalesce(regexp_matches(a.descr, ?), false)",
                                           [_rx(spec.exclude_desc)]))
    if spec.exclude_wikidata:
        exclude("classes", _wikidata_ids(con, spec.exclude_wikidata, False))
    if spec.exclude_categories:
        exclude("catégories", _category_ids(con, spec.exclude_categories)[0])
    included, missing = _titles(con, spec.include)
    for i in included:
        family_of.setdefault(i, "Ajouts")
    ids |= included
    return Selection(results, {i: family_of[i] for i in ids}, excluded, included, missing, ids)
