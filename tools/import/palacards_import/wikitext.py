"""Mesures de qualité d'un article à partir de son wikicode (pures, testées)."""

from __future__ import annotations

import re
from dataclasses import dataclass

_REF = re.compile(r"<ref[\s>/]", re.IGNORECASE)
_SECTION = re.compile(r"^==+[^=].*?==+\s*$", re.MULTILINE)
_FILE_LINK = re.compile(r"\[\[\s*(?:fichier|file|image)\s*:", re.IGNORECASE)
_INFOBOX_IMAGE = re.compile(
    r"\|\s*(?:image|photo|logo|carte)\s*=\s*[^|\n}]*\.(?:jpe?g|png|svg|gif|tiff?|webp)", re.IGNORECASE
)
_LINK = re.compile(
    r"\[\[(?!\s*(?:fichier|file|image|catégorie|category|media|média)\s*:)(?!\s*[a-z]{2,3}(?:-[a-z]+)?:)[^\]\[]",
    re.IGNORECASE,
)


# --- Longueur de la prose ---------------------------------------------------------------------
# Le wikicode brut surévalue les articles faits de modèles et de tableaux (communes : infobox,
# tableaux de démographie, listes de maires, références automatiques). La prose est le texte
# réellement lu : sans modèles, tableaux, références, fichiers, catégories ni balisage.
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_REF_BLOCK = re.compile(r"<ref\b[^>/]*/>|<ref\b[^>]*>.*?</ref\s*>", re.IGNORECASE | re.DOTALL)
_DROP_TAGS = re.compile(
    r"<(gallery|references|math|timeline|graph|mapframe|maplink|imagemap|score|syntaxhighlight|source|pre)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_TEMPLATE = re.compile(r"\{\{(?:(?!\{\{|\}\}).)*\}\}", re.DOTALL)  # le plus interne d'abord
_TABLE = re.compile(r"\{\|(?:(?!\{\||\|\}).)*\|\}", re.DOTALL)
_PLAIN_LINK = re.compile(
    r"\[\[(?!\s*(?:fichier|file|image|média|media|catégorie|category)\s*:)([^\[\]|]*)(?:\|([^\[\]]*))?\]\]",
    re.IGNORECASE,
)
_SPECIAL_LINK = re.compile(r"\[\[[^\[\]]*\]\]")  # restants : fichiers, catégories, interwikis
_EXT_LINK = re.compile(r"\[(?:https?:)?//[^\s\]]+(?:\s([^\]]*))?\]")
_HEADING = re.compile(r"^=+.*?=+\s*$", re.MULTILINE)
_HTML_TAG = re.compile(r"</?[a-zA-Z][^>]*>")
_MARKUP = re.compile(r"'{2,}|__[A-Z]+__|^[*#:;]+", re.MULTILINE)
_SPACES = re.compile(r"\s+")
_MAX_PASSES = 50


def _strip_nested(pattern: re.Pattern[str], text: str, repl: str = "") -> str:
    for _ in range(_MAX_PASSES):
        text, n = pattern.subn(repl, text)
        if n == 0:
            break
    return text


def prose_length(text: str) -> int:
    """Nombre de caractères de texte lisible (espaces normalisés)."""
    text = _COMMENT.sub("", text)
    text = _DROP_TAGS.sub("", text)
    text = _REF_BLOCK.sub("", text)
    text = _strip_nested(_TEMPLATE, text)
    text = _strip_nested(_TABLE, text)
    # Liens internes : [[cible|texte]] -> texte, [[cible]] -> cible (d'abord les plus internes,
    # pour les légendes de fichiers qui contiennent des liens), puis on retire le reste.
    text = _strip_nested(_PLAIN_LINK, text, lambda m: m.group(2) if m.group(2) is not None else m.group(1))  # type: ignore[arg-type]
    text = _strip_nested(_SPECIAL_LINK, text)
    text = _EXT_LINK.sub(lambda m: m.group(1) or "", text)
    text = _HEADING.sub("", text)
    text = _HTML_TAG.sub("", text)
    text = _MARKUP.sub("", text)
    return len(_SPACES.sub(" ", text).strip())


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
