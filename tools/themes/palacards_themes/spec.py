"""Fiche d'un booster à thème (YAML) : voir `exemple.yaml` à côté du paquet.

Un booster = des familles (jeux, personnages, consoles…). Chaque famille réunit des sources
(classes Wikidata, catégories Wikipédia, motifs de titre, titres) puis applique ses filtres
(rareté minimale, personnes, descriptions). Les exclusions et ajouts globaux viennent après.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

import yaml

from .index import RARITIES

PROPS = {"P31", "P106", "P641", "P27", "P17", "P136"}
# Propriétés dont les valeurs sont des classes : on prend aussi leurs sous-classes (P279*).
CLASS_PROPS = {"P31", "P106", "P641", "P136"}


def _list(v) -> list:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _qids(v) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for prop, values in (v or {}).items():
        prop = str(prop).upper()
        if prop not in PROPS:
            raise SystemExit(f"Propriété Wikidata non indexée : {prop} (connues : {', '.join(sorted(PROPS))})")
        out[prop] = [int(str(q).upper().lstrip("Q")) for q in _list(values)]
    return out


def category_name(name: str) -> str:
    name = re.sub(r"^(Catégorie|Category)\s*:", "", str(name).strip(), flags=re.IGNORECASE).replace("_", " ").strip()
    return name[:1].upper() + name[1:]


def title_name(title: str) -> str:
    title = str(title).strip().replace("_", " ")
    return title[:1].upper() + title[1:]


@dataclass
class Categories:
    names: list[str]
    depth: int


def _categories(v, default_depth: int) -> list[Categories]:
    out: list[Categories] = []
    for item in _list(v):
        if isinstance(item, dict):
            out.append(Categories([category_name(n) for n in _list(item.get("name") or item.get("names"))],
                                  int(item.get("depth", default_depth))))
        else:
            out.append(Categories([category_name(item)], default_depth))
    return out


@dataclass
class Family:
    name: str
    wikidata: dict[str, list[int]] = field(default_factory=dict)
    exact: bool = False  # sans les sous-classes
    categories: list[Categories] = field(default_factory=list)
    title_regex: list[str] = field(default_factory=list)
    titles: list[str] = field(default_factory=list)
    min_rarity: str = "C"
    people: str = "any"  # any | only | none
    keep_desc: list[str] = field(default_factory=list)
    keep_no_desc: bool = True
    drop_desc: list[str] = field(default_factory=list)
    drop_title_regex: list[str] = field(default_factory=list)
    drop_wikidata: dict[str, list[int]] = field(default_factory=dict)
    drop_categories: list[Categories] = field(default_factory=list)


@dataclass
class Spec:
    path: Path
    name: str
    description: str
    display_category: str
    price: int | None
    starts: datetime
    ends: datetime
    families: list[Family]
    exclude_titles: list[str]
    exclude_title_regex: list[str]
    exclude_desc: list[str]
    exclude_wikidata: dict[str, list[int]]
    exclude_categories: list[Categories]
    include: list[str]

    @property
    def slug(self) -> str:
        s = unicodedata.normalize("NFKD", self.name).encode("ascii", "ignore").decode().lower()
        return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _date(v, default: datetime) -> datetime:
    if v in (None, "now", "maintenant"):
        return default
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    d = datetime.fromisoformat(str(v))
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def _check_regex(patterns: list[str], where: str) -> list[str]:
    for p in patterns:
        try:
            re.compile(p)
        except re.error as err:
            raise SystemExit(f"Regex invalide dans {where} : {p!r} ({err})") from err
    return patterns


def load(path: str | Path) -> Spec:
    path = Path(path)
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not raw.get("name"):
        raise SystemExit("La fiche doit avoir un `name`.")
    families = []
    for i, f in enumerate(_list(raw.get("families"))):
        depth = int(f.get("depth", 1))
        fam = Family(
            name=f.get("name") or f"Famille {i + 1}",
            wikidata=_qids(f.get("wikidata")),
            exact=bool(f.get("exact", False)),
            categories=_categories(f.get("categories"), depth),
            title_regex=_check_regex(_list(f.get("title_regex")), f"{f.get('name')}.title_regex"),
            titles=[title_name(t) for t in _list(f.get("titles"))],
            min_rarity=str(f.get("min_rarity", "C")).upper(),
            people=str(f.get("people", "any")),
            keep_desc=_check_regex(_list(f.get("keep_desc")), f"{f.get('name')}.keep_desc"),
            keep_no_desc=bool(f.get("keep_no_desc", True)),
            drop_desc=_check_regex(_list(f.get("drop_desc")), f"{f.get('name')}.drop_desc"),
            drop_title_regex=_check_regex(_list(f.get("drop_title_regex")), f"{f.get('name')}.drop_title_regex"),
            drop_wikidata=_qids(f.get("drop_wikidata")),
            drop_categories=_categories(f.get("drop_categories"), 0),
        )
        if fam.min_rarity not in RARITIES:
            raise SystemExit(f"{fam.name} : min_rarity parmi {RARITIES}")
        if fam.people not in {"any", "only", "none"}:
            raise SystemExit(f"{fam.name} : people vaut any, only ou none")
        families.append(fam)
    if not families and not raw.get("include"):
        raise SystemExit("La fiche n'a aucune famille.")
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    starts = _date(raw.get("starts"), now)
    ends = _date(raw.get("ends"), starts + timedelta(days=int(raw.get("days", 7))))
    if ends <= starts:
        raise SystemExit("`ends` doit être après `starts`.")
    ex = raw.get("exclude") or {}
    return Spec(
        path=path,
        name=str(raw["name"]),
        description=str(raw.get("description", "")),
        display_category=str(raw.get("display_category") or "|".join(f.name for f in families)),
        price=int(raw["price"]) if raw.get("price") else None,
        starts=starts,
        ends=ends,
        families=families,
        exclude_titles=[title_name(t) for t in _list(ex.get("titles"))],
        exclude_title_regex=_check_regex(_list(ex.get("title_regex")), "exclude.title_regex"),
        exclude_desc=_check_regex(_list(ex.get("desc")), "exclude.desc"),
        exclude_wikidata=_qids(ex.get("wikidata")),
        exclude_categories=_categories(ex.get("categories"), 0),
        include=[title_name(t) for t in _list(raw.get("include"))],
    )
