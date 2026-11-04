# Atelier des boosters à thème

Crée un booster à thème en une dizaine de minutes au lieu de plus d'une heure : tout est lu dans un **index local**
(DuckDB) construit une fois par saison, sans parcourir l'API Wikipédia ni interroger Wikidata par lots.

Installé sur PalaServer : `/srv/nas/palacards-themes` (données sur le NAS, ~5 Go), lancé par `./run …`.

## L'index (une fois par saison)

```sh
cd /srv/nas/palacards-themes && nohup ./run index > data/index.log 2>&1 &
```

1. Dumps du Wikipédia FR (`page`, `categorylinks`, `linktarget`, `page_props`, ~1,6 Go) : arbre des catégories,
   articles de chaque catégorie, élément Wikidata de chaque article.
2. Wikidata en quelques requêtes en bloc sur [QLever](https://qlever.dev) : nature (P31), métier (P106), sport (P641),
   nationalité (P27), pays (P17), genre (P136), sous-classes (P279, en entier), descriptions et libellés en français.
3. Cartes de la saison active, exportées de la prod.

## Un booster

1. Écrire la fiche `data/themes/<nom>.yaml` (modèle : [`exemple.yaml`](exemple.yaml)). Pour trouver les noms :
   `./run find-cat "jeu vidéo"`, `./run find-class "console"`, `./run card "Tetris"`.
2. `./run preview data/themes/<nom>.yaml` (quelques secondes) : cartes par rareté et par famille, légendaires, UR,
   descriptions suspectes, catégories qui apportent le plus, échantillons. Rapport complet dans
   `data/themes/<slug>/preview.md`. Ajuster la fiche, recommencer.
3. `./run create data/themes/<nom>.yaml` : essai en prod dans une transaction annulée.
4. `./run create data/themes/<nom>.yaml --go` : sauvegarde (`palacards-backup.service`), puis création en une
   transaction (thème, cartes avec rareté et rang, index de tirage), en quelques secondes.

## Les caisses de la semaine

Deux thèmes par semaine, chacun en quatre niveaux (Bronze, Argent, Or, Légendaire), renouvelés le lundi soir.
Le contenu de chaque niveau = les cartes les plus lues du thème dans chaque rareté (`CASE_CONTENT` de
`packages/game/src/cases.ts`, recopié dans `palacards_themes/cases.py`).

```sh
./run case --theme 24                    # essai à partir d'un booster en base (transaction annulée)
./run case --theme 24 --go               # sauvegarde puis création, jusqu'au lundi 23 h 59 suivant
./run case data/themes/<nom>.yaml --go   # ou à partir d'une fiche, sans créer de booster
```

`--name` change le nom affiché, `--starts` / `--ends` les dates (heure de Paris si sans fuseau). Refusé si une
rareté manque à un niveau (une Bronze sans rare, une Or sans légendaire) ou si des caisses du même nom sont
déjà en vente sur ces dates.

Règles de prix (doc 22 du projet Infra Palawi) : 200 PW avec assez de légendaires, sinon 150 PW ; jamais sous 150.
