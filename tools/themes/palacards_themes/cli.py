"""palacards-themes : index | preview | create | find-cat | find-class | card.

Exemples (sur PalaServer, depuis /srv/nas/palacards-themes) :
  ./run index                         # une fois par saison, ~15 à 25 min, en arrière-plan
  ./run preview themes/jeux-video.yaml
  ./run create themes/jeux-video.yaml           # essai (transaction annulée)
  ./run create themes/jeux-video.yaml --go      # sauvegarde puis création
  ./run find-cat "jeu vidéo"
  ./run find-class "console de jeux"
  ./run card "Tetris"
"""

from __future__ import annotations

import argparse
import sys
import time

from . import create as create_mod
from . import index, paths, prod, report, spec
from .select import select


def _meta(con) -> dict[str, str]:
    return dict(con.execute("SELECT key, value FROM meta").fetchall())


def cmd_index(a) -> None:
    index.build(a.season, download=not a.no_download, wikidata_fetch=not a.no_wikidata)


def _run(a):
    s = spec.load(a.spec)
    con = index.connect()
    meta = _meta(con)
    t = time.time()
    sel = select(con, s)
    return s, con, meta, sel, time.time() - t


def cmd_preview(a) -> None:
    s, con, meta, sel, took = _run(a)
    md, summary = report.preview(con, s, sel, int(meta["season"]), meta["dump"])
    out = paths.THEMES / s.slug
    out.mkdir(parents=True, exist_ok=True)
    (out / "preview.md").write_text(md, encoding="utf-8")
    (out / "ids.txt").write_text("\n".join(str(i) for i in sorted(sel.ids)) + "\n")
    print(summary)
    print(f"Sélection en {took:.1f} s · aperçu : {out / 'preview.md'}")


def cmd_create(a) -> None:
    s, _con, meta, sel, _ = _run(a)
    season = int(meta["season"])
    price = a.price or s.price
    if not price:
        raise SystemExit("Prix manquant : `price:` dans la fiche ou --price.")
    if price < 150:
        raise SystemExit("Pas sous 150 PW : acheter puis recycler rapporterait des PW (doc 22).")
    if len(sel.ids) < 5:
        raise SystemExit("Moins de 5 cartes : thème trop petit.")
    sql = create_mod.script(s, sorted(sel.ids), season, price, a.by, commit=a.go)
    out = paths.THEMES / s.slug
    out.mkdir(parents=True, exist_ok=True)
    (out / ("create.sql" if a.go else "create-dry-run.sql")).write_text(sql, encoding="utf-8")
    if a.go:
        print("Sauvegarde de la base…")
        prod.backup()
    t = time.time()
    res = prod.psql(sql)
    print(res.strip())
    print(f"{'Créé' if a.go else 'Essai annulé (rien d’écrit)'} en {time.time() - t:.1f} s : "
          f"{s.name}, {len(sel.ids):,} cartes, {price} PW, du {s.starts:%Y-%m-%d %H:%M} au {s.ends:%Y-%m-%d %H:%M} UTC")


def cmd_find_cat(a) -> None:
    con = index.connect()
    rows = con.execute(
        """WITH m AS (SELECT cat AS title, count(*) n FROM cat_member WHERE cat ILIKE ? GROUP BY 1),
           e AS (SELECT parent AS title, count(*) n FROM cat_edge WHERE parent ILIKE ? GROUP BY 1)
           SELECT coalesce(m.title, e.title) t, coalesce(m.n, 0), coalesce(e.n, 0)
           FROM m FULL JOIN e ON e.title = m.title
           ORDER BY coalesce(m.n, 0) + 20 * coalesce(e.n, 0) DESC LIMIT ?""",
        [f"%{a.text}%", f"%{a.text}%", a.limit],
    ).fetchall()
    for title, n, sub in rows:
        print(f"{n:>7,} articles {sub:>5,} sous-cat.  {title}")


def cmd_find_class(a) -> None:
    con = index.connect()
    rows = con.execute(
        """WITH l AS (SELECT q, label FROM labels WHERE label ILIKE ?),
           a AS (SELECT v, count(*) n FROM p31 WHERE v IN (SELECT q FROM l) GROUP BY v),
           b AS (SELECT v, count(*) n FROM p106 WHERE v IN (SELECT q FROM l) GROUP BY v),
           c AS (SELECT v, count(*) n FROM p641 WHERE v IN (SELECT q FROM l) GROUP BY v)
           SELECT l.q, l.label, coalesce(a.n, 0), coalesce(b.n, 0), coalesce(c.n, 0) FROM l
           LEFT JOIN a ON a.v = l.q LEFT JOIN b ON b.v = l.q LEFT JOIN c ON c.v = l.q
           ORDER BY coalesce(a.n, 0) + coalesce(b.n, 0) + coalesce(c.n, 0) DESC LIMIT ?""",
        [f"%{a.text}%", a.limit],
    ).fetchall()
    print("Comptes directs (sans les sous-classes) : P31 nature, P106 métier, P641 sport")
    for q, label, p31, p106, p641 in rows:
        print(f"Q{q:<10} P31 {p31:>7,}  P106 {p106:>7,}  P641 {p641:>6,}  {label}")


def cmd_card(a) -> None:
    con = index.connect()
    row = con.execute("SELECT id, title, rarity, views, q, descr FROM art WHERE title = ?",
                      [spec.title_name(a.title)]).fetchone()
    if not row:
        raise SystemExit("Carte introuvable dans la saison.")
    cid, title, rarity, views, q, descr = row
    print(f"{title} · id {cid} · {rarity} · {views:,} vues · Q{q} · {descr or '—'}")
    for prop in ["P31", "P106", "P641", "P136", "P27"]:
        vals = con.execute(f"""SELECT 'Q' || t.v, coalesce(l.label, '?') FROM {prop.lower()} t
                               LEFT JOIN labels l ON l.q = t.v WHERE t.q = ?""", [q]).fetchall()
        if vals:
            print(f"  {prop} : " + ", ".join(f"{label} ({v})" for v, label in vals))
    cats = [r[0] for r in con.execute("SELECT cat FROM cat_member WHERE page_id = ? ORDER BY cat", [cid]).fetchall()]
    print("  Catégories : " + " · ".join(cats))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="palacards-themes", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("index", help="construit l'index local de la saison")
    s.add_argument("--season", type=int)
    s.add_argument("--no-download", action="store_true", help="réutilise les dumps déjà analysés")
    s.add_argument("--no-wikidata", action="store_true", help="réutilise les données Wikidata déjà téléchargées")
    s.set_defaults(fn=cmd_index)
    s = sub.add_parser("preview", help="aperçu d'une fiche")
    s.add_argument("spec")
    s.set_defaults(fn=cmd_preview)
    s = sub.add_parser("create", help="crée le booster (essai sans --go)")
    s.add_argument("spec")
    s.add_argument("--go", action="store_true", help="sauvegarde puis création pour de vrai")
    s.add_argument("--price", type=int)
    s.add_argument("--by", default="palawi", help="pseudo de l'admin créateur")
    s.set_defaults(fn=cmd_create)
    for name, fn in [("find-cat", cmd_find_cat), ("find-class", cmd_find_class)]:
        s = sub.add_parser(name)
        s.add_argument("text")
        s.add_argument("--limit", type=int, default=30)
        s.set_defaults(fn=fn)
    s = sub.add_parser("card", help="tout ce que l'index sait d'une carte")
    s.add_argument("title")
    s.set_defaults(fn=cmd_card)
    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
