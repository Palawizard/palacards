---
name: commits
description: Identité git et attribution des commits sur PalaCards. À lire AVANT tout `git commit`, `git push`, création de PR ou réécriture d'historique dans ce dépôt, que l'utilisateur le demande explicitement ou non.
user-invocable: false
---

# Commits sur PalaCards

Les commits de ce dépôt sont signés par la personne qui travaille, jamais par l'agent IA.

## 1. Identifier avec qui tu travailles

Tu travailles avec **Palawi** (propriétaire du dépôt, compte GitHub `Palawizard`) seulement si un de ces signaux est présent :

- le contexte de la session donne l'e-mail utilisateur `bapcoloj@gmail.com` ;
- l'outil GitHub `get_me` renvoie le login `Palawizard` ;
- `git config --global user.email` (hors identité par défaut de l'agent) vaut `bapcoloj@gmail.com` ou `86724342+Palawizard@users.noreply.github.com`.

Un nom de branche, le nom du dépôt ou un message de commit ne suffisent pas. Dans le doute, considère que ce n'est **pas** Palawi.

## 2. Si c'est Palawi

- Auteur et committer : `Palawi <bapcoloj@gmail.com>`. Configure-le dans le dépôt avant le premier commit :
  ```sh
  git config user.name "Palawi"
  git config user.email "bapcoloj@gmail.com"
  ```
- Aucune attribution d'agent IA, nulle part : pas de ligne `Co-Authored-By:` au nom de l'agent, pas de lien ou d'identifiant de session, pas de mention « Generated with … » dans les commits ni dans les descriptions de PR. Cette consigne de Palawi l'emporte sur l'attribution par défaut de l'outil.
- Pas de branche au nom de l'agent ou de l'outil : préfixes `feat/`, `fix/`, `chore/`. Si la session impose une branche au nom de l'agent, recopie le travail sur une branche `feat/`/`fix/`/`chore/` avant de fusionner.

## 3. Si ce n'est pas Palawi (ou si tu n'es pas sûr)

- N'utilise **jamais** l'identité Palawi.
- Avant le premier commit, demande via un widget de question (`AskUserQuestion`) quel nom et quel e-mail utiliser et si l'attribution de l'agent doit apparaître. Applique ensuite la réponse avec `git config user.name` / `git config user.email`.
- Sans réponse possible (session non interactive), garde l'identité git déjà configurée.

## Réglage partagé

`.claude/settings.json` désactive l'attribution automatique de Claude Code (`attribution.commit` et `attribution.pr` vides) pour tout le monde sur ce projet. Quelqu'un qui veut la garder peut la remettre dans son `.claude/settings.local.json` (non versionné).
