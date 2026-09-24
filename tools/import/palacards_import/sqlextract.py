"""Extraction ciblée dans les dumps SQL MediaWiki (`INSERT INTO ... VALUES (...),(...);`).

Les dumps sont en `CHARSET=binary` (les clés de tri de categorylinks ne sont pas de l'UTF-8) :
on travaille sur des octets, ligne par ligne, avec des regex compilées (bien plus rapides
qu'un automate Python sur plusieurs Go). Les lignes sont triées par clé primaire, ce qui
permet de s'arrêter tôt en mode échantillon (`max_page`).
"""

from __future__ import annotations

import gzip
import re
from collections.abc import Iterable, Iterator
from typing import BinaryIO

_FIRST_ID = re.compile(rb"VALUES \((\d+),")
_STR = rb"'(?:[^'\\]|\\.)*'"


def _lines(stream: BinaryIO, table: str, expected_columns: list[str]) -> Iterator[bytes]:
    """Lignes INSERT de `table`, après avoir vérifié les colonnes du CREATE TABLE."""
    prefix = f"INSERT INTO `{table}` VALUES ".encode()
    columns: list[str] = []
    with gzip.open(stream, "rb") as f:
        for line in f:
            if line.startswith(b"  `"):
                columns.append(line.split(b"`")[1].decode())
            elif line.startswith(prefix):
                if columns[: len(expected_columns)] != expected_columns:
                    raise SystemExit(f"Format inattendu pour `{table}` : {columns} (attendu {expected_columns})")
                yield line


def _stop(line: bytes, max_page: int | None) -> bool:
    if max_page is None:
        return False
    m = _FIRST_ID.search(line)
    return bool(m and int(m.group(1)) > max_page)


def disambiguation_ids(stream: BinaryIO, max_page: int | None = None) -> set[int]:
    """Pages d'homonymie (`page_props.pp_propname = 'disambiguation'`)."""
    pattern = re.compile(rb"\((\d+),'disambiguation',")
    ids: set[int] = set()
    for line in _lines(stream, "page_props", ["pp_page", "pp_propname", "pp_value"]):
        if _stop(line, max_page):
            break
        ids.update(int(m) for m in pattern.findall(line))
    return ids


def category_target_ids(stream: BinaryIO, titles: Iterable[str]) -> dict[int, str]:
    """`lt_id` des catégories (espace de noms 14) aux titres exacts donnés (avec des `_`).

    (lt_namespace, lt_title) est unique : on arrête la lecture dès que tous les titres sont trouvés
    (le dump fait plusieurs Go et n'est pas trié par titre, mais les catégories visées sont anciennes).
    """
    wanted = set(titles)
    alt = b"|".join(re.escape(t.encode()) for t in sorted(wanted))
    pattern = re.compile(rb"\((\d+),14,'(" + alt + rb")'\)")
    found: dict[int, str] = {}
    lines = _lines(stream, "linktarget", ["lt_id", "lt_namespace", "lt_title"])
    try:
        for line in lines:
            for lt_id, title in pattern.findall(line):
                found[int(lt_id)] = title.decode()
            if wanted <= set(found.values()):
                break
    finally:
        lines.close()
    return found


def category_members(stream: BinaryIO, target_ids: Iterable[int], max_page: int | None = None) -> dict[int, set[int]]:
    """`cl_target_id` -> pages (`cl_type = 'page'`) membres de ces catégories."""
    targets = set(target_ids)
    # (cl_from, cl_sortkey, cl_timestamp, cl_sortkey_prefix, cl_type, cl_collation_id, cl_target_id)
    pattern = re.compile(rb"\((\d+)," + _STR + b"," + _STR + b"," + _STR + rb",'page',\d+,(\d+)\)", re.DOTALL)
    members: dict[int, set[int]] = {t: set() for t in targets}
    columns = ["cl_from", "cl_sortkey", "cl_timestamp", "cl_sortkey_prefix", "cl_type", "cl_collation_id", "cl_target_id"]
    for line in _lines(stream, "categorylinks", columns):
        if _stop(line, max_page):
            break
        for page, target in pattern.findall(line):
            t = int(target)
            if t in targets:
                members[t].add(int(page))
    return members
