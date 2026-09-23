"""Mesures de qualité d'un article à partir de son wikicode (pures, testées)."""

from __future__ import annotations

import re
from dataclasses import dataclass

_REF = re.compile(r"<ref[\s>/]", re.IGNORECASE)
_SECTION = re.compile(r"^==+[^=].*?==+\s*$", re.MULTILINE)
_FILE_LINK = re.compile(r"\[\[\s*(?:fichier|file|image)\s*:", re.IGNORECASE)
_INFOBOX_IMAGE = re.compile(r"\|\s*(?:image|photo|logo|carte)\s*=\s*[^|\n}]*\.(?:jpe?g|png|svg|gif|tiff?|webp)", re.IGNORECASE)
_LINK = re.compile(
    r"\[\[(?!\s*(?:fichier|file|image|catégorie|category|media|média)\s*:)(?!\s*[a-z]{2,3}(?:-[a-z]+)?:)[^\]\[]",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ArticleStats:
    refs: int
    sections: int
    images: int
    links: int


def measure(text: str) -> ArticleStats:
    return ArticleStats(
        refs=len(_REF.findall(text)),
        sections=len(_SECTION.findall(text)),
        images=len(_FILE_LINK.findall(text)) + len(_INFOBOX_IMAGE.findall(text)),
        links=len(_LINK.findall(text)),
    )
