from palacards_import.wikitext import measure

TEXT = """{{Infobox Ville
| image = Lyon.jpg
}}
'''Lyon''' est une [[ville]] de [[France|française]]<ref>source</ref>.<ref name="a" /><ref name=b>x</ref>
== Histoire ==
[[Fichier:Vue.png|vignette]] [[File:Autre.svg]]
=== Antiquité ===
Voir [[Lugdunum]].
== Notes ==
<references />
[[Catégorie:Ville de France]]
[[en:Lyon]]
"""


def test_measure_counts():
    s = measure(TEXT)
    assert s.refs == 3
    assert s.sections == 3
    assert s.images == 3  # 2 liens de fichiers + image d'infobox
    assert s.links == 3  # ville, France, Lugdunum (pas les catégories, fichiers ni interwikis)


def test_measure_empty():
    s = measure("")
    assert (s.refs, s.sections, s.images, s.links) == (0, 0, 0, 0)
