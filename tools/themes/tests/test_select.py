"""Sélection d'une fiche sur un petit index fabriqué à la main."""

from __future__ import annotations

import textwrap

import duckdb
import pytest

from palacards_themes import create, report, spec
from palacards_themes.select import category_tree, select, subclasses


@pytest.fixture()
def con():
    c = duckdb.connect()
    c.execute("""
        CREATE TABLE cards AS SELECT * FROM (VALUES
          (1, 'Tetris', 'SR', 3, 50000), (2, 'Mario', 'L', 5, 900000), (3, 'Super Mario Bros. (film)', 'UR', 4, 80000),
          (4, 'Pac-Man', 'PC', 1, 900), (5, 'Joueur obscur', 'C', 0, 10), (6, 'Squeezie', 'UR', 4, 70000),
          (7, 'Paris', 'L', 5, 2000000), (8, 'Jeu de go', 'R', 2, 5000)) t(id, title, rarity, r, views);
        CREATE TABLE cat_edge AS SELECT * FROM (VALUES
          ('Jeu de réflexion', 'Jeu vidéo'), ('Jeu vidéo', 'Jeu de réflexion'), ('Jeu de plateau', 'Jeu')) t(child, parent);
        CREATE TABLE cat_member AS SELECT * FROM (VALUES
          (1, 'Jeu de réflexion'), (4, 'Jeu vidéo'), (8, 'Jeu de plateau')) t(page_id, cat);
        CREATE TABLE qid AS SELECT * FROM (VALUES (1, 101), (2, 102), (3, 103), (4, 104), (5, 105), (6, 106))
          t(page_id, q);
        CREATE TABLE p31 AS SELECT * FROM (VALUES
          (101, 7889), (102, 1569167), (103, 11424), (104, 900), (105, 5), (106, 5)) t(q, v);
        CREATE TABLE p106 AS SELECT * FROM (VALUES (105, 4379701), (106, 57414145)) t(q, v);
        CREATE TABLE p641 (q BIGINT, v BIGINT);
        CREATE TABLE p27 (q BIGINT, v BIGINT);
        CREATE TABLE p17 (q BIGINT, v BIGINT);
        CREATE TABLE p136 (q BIGINT, v BIGINT);
        -- 900 (jeu d'arcade) est une sous-classe de jeu vidéo ; cycle 7889 <-> 901 pour la fermeture.
        CREATE TABLE p279 AS SELECT * FROM (VALUES (900, 7889), (901, 7889), (7889, 901)) t(c, p);
        CREATE TABLE labels AS SELECT * FROM (VALUES (7889, 'jeu vidéo'), (5, 'être humain')) t(q, label);
        CREATE TABLE descr AS SELECT * FROM (VALUES
          (101, 'jeu vidéo de réflexion'), (102, 'personnage de jeu vidéo'), (103, 'film américain'),
          (104, 'jeu vidéo d''arcade'), (105, 'joueur de jeux vidéo'), (106, 'vidéaste web français')) t(q, text);
        CREATE TABLE art AS
        SELECT c.id, c.title, c.rarity, c.r, c.views, q.q, d.text AS descr,
               EXISTS (SELECT 1 FROM p31 WHERE p31.q = q.q AND p31.v = 5) AS person
        FROM cards c LEFT JOIN qid q ON q.page_id = c.id LEFT JOIN descr d ON d.q = q.q;
    """)
    return c


def write(tmp_path, body: str):
    p = tmp_path / "fiche.yaml"
    p.write_text(textwrap.dedent(body), encoding="utf-8")
    return spec.load(p)


def test_subclasses_and_cycles(con):
    assert sorted(subclasses(con, [7889])) == [900, 901, 7889]
    assert category_tree(con, [spec.Categories(["Jeu vidéo"], 5)]) == {"Jeu vidéo": 0, "Jeu de réflexion": 1}


def test_families_filters_and_includes(tmp_path, con):
    s = write(tmp_path, """
        name: Jeux vidéo
        price: 150
        families:
          - name: Jeux
            wikidata: {P31: [Q7889]}
            drop_desc: ['\\bfilm\\b']
          - name: Joueurs
            wikidata: {P106: [Q4379701, Q57414145]}
            min_rarity: PC
          - name: Catégories
            categories: [{name: "Catégorie:Jeu_vidéo", depth: 1}]
        exclude:
          titles: [Pac-Man]
        include: [Mario, Inconnu]
    """)
    sel = select(con, s)
    # Tetris et Pac-Man (sous-classe) par P31, Squeezie par métier ; le joueur C est sous la rareté minimale.
    assert sel.ids == {1, 6, 2}
    assert sel.family_of[1] == "Jeux" and sel.family_of[2] == "Ajouts"
    assert sel.missing_include == ["Inconnu"]
    assert sel.excluded == {"titres": 1}
    jeux = sel.families[0]
    assert jeux.sources == {"wikidata": 2} and jeux.dropped == {}
    joueurs = sel.families[1]
    assert joueurs.dropped == {"rareté < PC": 1}
    md, summary = report.preview(con, s, sel, 1, "2026-11-02")
    assert "Légendaires (1)" in md and "Mario" in md
    assert summary.startswith("Jeux vidéo : 3 cartes")


def test_people_and_description_filters(tmp_path, con):
    s = write(tmp_path, """
        name: Test
        families:
          - name: Tout
            title_regex: ['^(Mario|Squeezie|Super Mario)']
            people: none
            keep_desc: ['jeu']
    """)
    assert select(con, s).ids == {2}


def test_create_script(tmp_path, con):
    s = write(tmp_path, """
        name: L'essai
        price: 200
        starts: 2026-11-05T08:00Z
        days: 7
        families: [{name: Jeux, wikidata: {P31: [Q7889]}}]
    """)
    sql = create.script(s, [4, 1], 1, 200, "palawi", commit=False)
    assert "'L''essai'" in sql and "2026-11-12T08:00:00+00:00" in sql
    assert "COPY _ids FROM STDIN;\n1\n4\n\\." in sql
    assert sql.strip().endswith("ROLLBACK;")
    assert "COMMIT" in create.script(s, [1], 1, 200, "palawi", commit=True)


def test_spec_errors(tmp_path):
    with pytest.raises(SystemExit):
        write(tmp_path, "name: x\nfamilies: [{name: a, wikidata: {P999: [Q1]}}]\n")
    with pytest.raises(SystemExit):
        write(tmp_path, "name: x\nfamilies: [{name: a, min_rarity: Z}]\n")
