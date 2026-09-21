"""Étape 1 : télécharge les dumps frwiki et les pageviews mensuels. (À implémenter en phase 0.)"""

DUMPS = [
    "https://dumps.wikimedia.org/frwiki/latest/frwiki-latest-page.sql.gz",
    "https://dumps.wikimedia.org/frwiki/latest/frwiki-latest-page_props.sql.gz",
    "https://dumps.wikimedia.org/frwiki/latest/frwiki-latest-categorylinks.sql.gz",
    "https://dumps.wikimedia.org/frwiki/latest/frwiki-latest-pages-articles-multistream.xml.bz2",
]


def run() -> None:
    raise NotImplementedError("phase 0 : téléchargement des dumps")
