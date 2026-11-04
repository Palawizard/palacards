"""Aperçu d'une fiche : chiffres par rareté et par famille, légendaires, bruit probable, échantillons."""

from __future__ import annotations

import duckdb

from .index import RARITIES
from .select import Selection
from .spec import Spec

# Mots de description qui signalent souvent un hors-sujet : à regarder, pas à exclure d'office.
NOISE = {
    "film": r"\bfilm\b",
    "série télévisée": r"série télévisée|feuilleton",
    "album / chanson": r"\balbum\b|chanson|\bsingle\b",
    "épisode": r"épisode",
    "liste": r"^liste\b|\bliste de\b",
    "commune / ville": r"\bcommune\b|\bvillage\b|\bville\b",
    "footballeur": r"footballeu",
    "homme / femme politique": r"(homme|femme|personnalité) politique",
    "acteur / actrice": r"\bact(eur|rice)\b",
    "chanteur / chanteuse": r"chanteu(r|se)",
    "personnage de fiction": r"personnage de fiction|personnage de",
    "entreprise": r"entreprise|société",
    "taxon / espèce": r"espèce|\bgenre de\b|taxon",
    "astéroïde / galaxie": r"astéroïde|galaxie",
}


def _md_table(headers: list[str], rows: list[list]) -> str:
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(str(c).replace("|", "/") for c in r) + " |" for r in rows]
    return "\n".join(out)


def _counts(con, ids: list[int]) -> dict[str, int]:
    con.execute("CREATE OR REPLACE TEMP TABLE _sel AS SELECT unnest(?::BIGINT[]) AS id", [ids])
    rows = con.execute("SELECT a.rarity, count(*) FROM art a JOIN _sel USING (id) GROUP BY 1").fetchall()
    found = dict(rows)
    return {r: found.get(r, 0) for r in RARITIES}


def price_hint(legendaries: int) -> str:
    # Règle de Palawi (2026-10-19) : assez de légendaires -> 200 PW, sinon 150 ; jamais sous 150
    # (valeur de recyclage moyenne d'un booster à thème ~126 PW).
    return "200 PW" if legendaries >= 10 else "150 PW (ou 200 + légendaires ajoutées)"


def preview(con: duckdb.DuckDBPyConnection, spec: Spec, sel: Selection, season: int, dump: str) -> tuple[str, str]:
    """(rapport complet en Markdown, résumé court)."""
    ids = sorted(sel.ids)
    total = _counts(con, ids)
    con.execute("CREATE OR REPLACE TEMP TABLE _fam AS SELECT unnest(?::BIGINT[]) AS id, unnest(?::VARCHAR[]) AS fam",
                [list(sel.family_of), list(sel.family_of.values())])
    lines = [f"# Aperçu : {spec.name}", "",
             f"Saison {season} · index du dump {dump} · fiche `{spec.path}`", "",
             (f"**{len(ids):,} cartes** · prix conseillé : {price_hint(total['L'])}"
              f"{f' · prix de la fiche : {spec.price} PW' if spec.price else ''}"
              f" · du {spec.starts:%Y-%m-%d %H:%M} au {spec.ends:%Y-%m-%d %H:%M} UTC"), "",
             _md_table(RARITIES + ["Total"], [[f"{total[r]:,}" for r in RARITIES] + [f"{len(ids):,}"]]), ""]
    if sel.missing_include:
        lines += [f"**Ajouts introuvables dans les cartes** : {', '.join(sel.missing_include)}", ""]
    if sel.excluded:
        lines += ["Exclusions globales : " + ", ".join(f"{k} −{v:,}" for k, v in sel.excluded.items()), ""]

    # Familles
    rows = []
    for fr in sel.families:
        mine = [i for i, f in sel.family_of.items() if f == fr.family.name]
        c = _counts(con, mine)
        rows.append([fr.family.name, " + ".join(f"{k} {v:,}" for k, v in fr.sources.items()),
                     ", ".join(f"{k} −{v:,}" for k, v in fr.dropped.items()) or "—",
                     *[f"{c[r]:,}" for r in RARITIES], f"{len(mine):,}"])
    lines += ["## Familles", "", "Une carte compte dans la première famille qui la contient.", "",
              _md_table(["Famille", "Sources", "Retirées", *RARITIES, "Total"], rows), ""]
    for fr in sel.families:
        warn = []
        if fr.missing_categories:
            warn.append(f"catégories inconnues : {', '.join(fr.missing_categories)}")
        if fr.missing_titles:
            warn.append(f"titres introuvables : {', '.join(fr.missing_titles)}")
        if warn:
            lines += [f"- **{fr.family.name}** : " + " ; ".join(warn)]
    lines.append("")

    # Légendaires et UR
    leg = con.execute("""SELECT a.title, coalesce(a.descr, ''), f.fam FROM art a JOIN _fam f USING (id)
                         WHERE a.rarity = 'L' ORDER BY a.views DESC""").fetchall()
    lines += [f"## Légendaires ({len(leg)})", "", _md_table(["Carte", "Description", "Famille"], leg) if leg
              else "Aucune.", ""]
    ur = con.execute("""SELECT a.title, coalesce(a.descr, ''), f.fam FROM art a JOIN _fam f USING (id)
                        WHERE a.rarity = 'UR' ORDER BY a.views DESC LIMIT 80""").fetchall()
    lines += [f"## UR ({total['UR']:,}, les 80 plus lues)", "", _md_table(["Carte", "Description", "Famille"], ur), ""]

    # Bruit probable
    lines += ["## À vérifier (descriptions souvent hors sujet)", ""]
    noise_rows = []
    for label, rx in NOISE.items():
        hits = con.execute(f"""SELECT a.title, a.rarity FROM art a JOIN _fam USING (id)
                               WHERE regexp_matches(a.descr, '(?i){rx}') ORDER BY a.views DESC""").fetchall()
        if hits:
            noise_rows.append([label, f"{len(hits):,}", ", ".join(f"{t} ({r})" for t, r in hits[:6])])
    lines += [_md_table(["Motif", "Cartes", "Exemples (les plus lues)"], noise_rows) if noise_rows else "Rien.", ""]

    # Par famille : natures, descriptions, catégories qui apportent le plus, échantillons
    for fr in sel.families:
        name = fr.family.name
        lines += [f"## {name}", ""]
        top31 = con.execute("""SELECT coalesce(l.label, 'Q' || p.v), count(*) n FROM _fam f JOIN art a USING (id)
                               JOIN p31 p ON p.q = a.q LEFT JOIN labels l ON l.q = p.v
                               WHERE f.fam = ? GROUP BY 1 ORDER BY n DESC LIMIT 12""", [name]).fetchall()
        if top31:
            lines += ["Natures (P31) : " + ", ".join(f"{label} {n:,}" for label, n in top31), ""]
        heads = con.execute("""SELECT array_to_string(list_slice(string_split(lower(a.descr), ' '), 1, 3), ' ') h,
                                      count(*) n FROM _fam f JOIN art a USING (id)
                               WHERE f.fam = ? AND a.descr IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 15""",
                            [name]).fetchall()
        if heads:
            lines += ["Débuts de description : " + ", ".join(f"« {h} » {n:,}" for h, n in heads), ""]
        if fr.tree:
            cats = con.execute("""SELECT m.cat, count(DISTINCT m.page_id) n FROM cat_member m
                                  JOIN _fam f ON f.id = m.page_id AND f.fam = ?
                                  WHERE m.cat IN (SELECT unnest(?::VARCHAR[])) GROUP BY 1 ORDER BY n DESC LIMIT 20""",
                               [name, list(fr.tree)]).fetchall()
            lines += ["Catégories qui apportent le plus : "
                      + ", ".join(f"{c} ({fr.tree[c]}) {n:,}" for c, n in cats), ""]
        sample = con.execute("""SELECT a.title, a.rarity, coalesce(a.descr, '—') FROM _fam f JOIN art a USING (id)
                                WHERE f.fam = ? ORDER BY hash(a.id) LIMIT 15""", [name]).fetchall()
        lines += [_md_table(["Échantillon", "Rareté", "Description"], sample), ""]

    summary = (f"{spec.name} : {len(ids):,} cartes ("
               + ", ".join(f"{r} {total[r]:,}" for r in RARITIES) + f") · prix conseillé {price_hint(total['L'])}")
    return "\n".join(lines), summary
