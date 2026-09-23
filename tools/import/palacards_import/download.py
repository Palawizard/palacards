"""Étape 1 : télécharge les dumps frwiki d'une exécution datée complète, avec reprise et vérification sha1.

Les pages vues (≈ 5 Go par mois) ne sont pas stockées : l'étape `views` les lit en flux.
En mode échantillon (`--limit`), rien n'est téléchargé : chaque étape lit le début des fichiers
directement sur dumps.wikimedia.org et s'arrête dès qu'elle a ce qu'il lui faut.
"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import BinaryIO

import requests

from . import paths

BASE = "https://dumps.wikimedia.org/frwiki"
# Job de dumpstatus.json -> suffixe du fichier
FILES = {
    "pagepropstable": "page_props.sql.gz",
    "categorylinkstable": "categorylinks.sql.gz",
    "linktargettable": "linktarget.sql.gz",
    "articlesmultistreamdumprecombine": "pages-articles-multistream.xml.bz2",
}
CHUNK = 1 << 20


def user_agent() -> str:
    ua = os.environ.get("WIKIMEDIA_USER_AGENT")
    if not ua:
        raise SystemExit("WIKIMEDIA_USER_AGENT manquant (voir .env.example) : Wikimedia exige un contact.")
    return ua


def session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = user_agent()
    return s


def find_dump_date(http: requests.Session, wanted: str | None = None) -> tuple[str, dict]:
    """Date de la dernière exécution où tous les jobs utiles sont terminés, et son dumpstatus.json."""
    if wanted:
        dates = [wanted]
    else:
        listing = http.get(f"{BASE}/", timeout=30).text
        dates = sorted(set(re.findall(r'href="(\d{8})/"', listing)), reverse=True)
    for date in dates:
        r = http.get(f"{BASE}/{date}/dumpstatus.json", timeout=30)
        if r.status_code != 200:
            continue
        status = r.json()
        jobs = status.get("jobs", {})
        if all(jobs.get(job, {}).get("status") == "done" for job in FILES):
            return date, status
    raise SystemExit("Aucune exécution complète trouvée sur dumps.wikimedia.org/frwiki/")


def file_name(date: str, suffix: str) -> str:
    return f"frwiki-{date}-{suffix}"


def local_path(suffix: str) -> Path | None:
    """Fichier téléchargé et vérifié pour ce suffixe (le plus récent), s'il existe."""
    found = sorted(paths.RAW.glob(f"frwiki-*-{suffix}"))
    return found[-1] if found else None


def sha1_of(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def fetch(http: requests.Session, url: str, dest: Path, size: int, sha1: str) -> None:
    """Télécharge `url` dans `dest` en reprenant un `.part` existant (en-tête Range)."""
    if dest.exists():
        print(f"  {dest.name} déjà présent")
        return
    part = dest.with_suffix(dest.suffix + ".part")
    done = part.stat().st_size if part.exists() else 0
    if done < size:
        headers = {"Range": f"bytes={done}-"} if done else {}
        with http.get(url, headers=headers, stream=True, timeout=60) as r:
            r.raise_for_status()
            if done and r.status_code != 206:
                done = 0  # le serveur ignore Range : on repart de zéro
            with part.open("ab" if done else "wb") as f:
                for chunk in r.iter_content(CHUNK):
                    f.write(chunk)
                    done += len(chunk)
                    if done % (256 * CHUNK) < CHUNK:
                        print(f"  {dest.name} : {done / size:6.1%}", flush=True)
    print(f"  vérification sha1 de {dest.name}…")
    if sha1_of(part) != sha1:
        part.unlink()
        raise SystemExit(f"sha1 invalide pour {dest.name} : fichier supprimé, relance `download`.")
    part.rename(dest)


def run(date: str | None = None) -> None:
    http = session()
    date, status = find_dump_date(http, date)
    print(f"download : exécution frwiki {date}")
    for job, suffix in FILES.items():
        name = file_name(date, suffix)
        meta = status["jobs"][job]["files"][name]
        fetch(http, f"https://dumps.wikimedia.org{meta['url']}", paths.RAW / name, int(meta["size"]), meta["sha1"])
    print("download : terminé")


def open_dump(suffix: str, date: str | None = None) -> BinaryIO:
    """Flux binaire d'un dump : le fichier local s'il a été téléchargé, sinon lecture en flux HTTP."""
    local = local_path(suffix)
    if local:
        return local.open("rb")
    http = session()
    date, _ = find_dump_date(http, date)
    url = f"{BASE}/{date}/{file_name(date, suffix)}"
    print(f"  lecture en flux de {url}")
    r = http.get(url, stream=True, timeout=60)
    r.raise_for_status()
    r.raw.decode_content = False
    return r.raw  # type: ignore[return-value]
