from palacards_import.wikitext import measure, prose_length

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


COMMUNE = """{{Infobox Commune de France
| nom = Village
| image = Eglise.jpg
| population = {{Population de France/dernière population|Village}}
}}
'''Village''' est une [[Commune en France|commune française]] de la [[Dordogne]].<ref>{{Lien web|url=https://insee.fr|titre=Insee}}</ref>
<!-- commentaire caché -->
== Démographie ==
{{Démographie
| 1793 = 512 | 1800 = 498 | 1806 = 530 | 1821 = 544 | 1831 = 560
}}
{| class="wikitable"
! Début !! Fin !! Maire
|-
| 2001 || 2020 || Jean {{nobr|Dupont}}
|-
| 2020 || en cours || Marie Martin
|}
[[Fichier:Mairie.jpg|vignette|La [[mairie]] du village.]]
{{Palette|Communes de la Dordogne}}
[[Catégorie:Commune en Dordogne]]
"""


def test_prose_length_ignores_templates_tables_refs_and_files():
    assert prose_length(COMMUNE) == len("Village est une commune française de la Dordogne.")


def test_prose_length_keeps_link_labels_and_external_link_text():
    text = "Voir [[Lyon]], [[France|la France]] et [https://exemple.fr ce site] [https://nu.fr]."
    assert prose_length(text) == len("Voir Lyon, la France et ce site .")


def test_prose_length_nested_templates_and_unclosed_markup():
    assert prose_length("A {{a|{{b|{{c}}}}}} B") == len("A B")
    # Wikicode cassé : pas de boucle infinie ni d'exception.
    assert prose_length("Texte {{modèle non fermé [[lien") > 0


def test_prose_length_empty():
    assert prose_length("") == 0
