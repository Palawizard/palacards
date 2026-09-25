import bz2
import io

import pyarrow.parquet as pq

from palacards_import.parse_articles import iter_articles, write_parquet

HEAD = (
    '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" version="0.11" xml:lang="fr"><siteinfo>'
    "<sitename>Wikipédia</sitename><dbname>frwiki</dbname><base>x</base><generator>g</generator>"
    '<case>first-letter</case><namespaces><namespace key="0" case="first-letter" />'
    '<namespace key="1" case="first-letter">Discussion</namespace></namespaces></siteinfo>'
)


def page(pid, title, text, ns=0, redirect=""):
    return (
        f"<page><title>{title}</title><ns>{ns}</ns><id>{pid}</id>{redirect}<revision><id>{pid}0</id>"
        "<timestamp>2026-01-01T00:00:00Z</timestamp><contributor><username>u</username><id>1</id></contributor>"
        f'<model>wikitext</model><format>text/x-wiki</format><text bytes="{len(text.encode())}" xml:space="preserve">'
        f"{text}</text><sha1>x</sha1></revision></page>"
    )


XML = (
    HEAD
    + page(1, "Élan", "Un [[cerf]].&lt;ref&gt;a&lt;/ref&gt;\n== Biologie ==\n")
    + page(2, "Discussion:Élan", "blabla", ns=1)
    + page(3, "Elan", "#REDIRECTION [[Élan]]", redirect='<redirect title="Élan" />')
    + page(4, "Paris", "[[Seine]] [[France]]")
    + "</mediawiki>"
)


def test_iter_articles_keeps_only_ns0_non_redirects():
    rows = list(iter_articles(io.BytesIO(XML.encode())))
    assert [r["page_id"] for r in rows] == [1, 4]
    assert rows[0]["title"] == "Élan"
    assert rows[0]["refs"] == 1 and rows[0]["sections"] == 1 and rows[0]["links"] == 1
    assert rows[1]["page_len"] == len("[[Seine]] [[France]]")


def test_write_parquet_with_limit_on_multistream(tmp_path):
    # multistream = plusieurs flux bz2 concaténés
    raw = bz2.compress(XML[: len(XML) // 2].encode()) + bz2.compress(XML[len(XML) // 2 :].encode())
    out = tmp_path / "a.parquet"
    n = write_parquet(iter_articles(bz2.BZ2File(io.BytesIO(raw))), out, limit=1)
    assert n == 1
    assert pq.read_table(out).column("page_id").to_pylist() == [1]
