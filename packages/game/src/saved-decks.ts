import { DECK_SIZE } from "./battle.js";

/**
 * Decks de bataille enregistrés : le joueur garde quelques compositions toutes prêtes et en choisit une au
 * lancement ou à l'acceptation d'un duel. Un deck reste privé (jamais montré aux autres joueurs). Une carte
 * qui a quitté la collection (recyclée, échangée, vendue, fusionnée) reste notée dans le deck, qui devient
 * inutilisable tant qu'elle n'est pas remplacée.
 */

/** Nombre maximal de decks enregistrés par joueur (appliqué par le serveur). */
export const SAVED_DECKS_MAX = 5;

/** Longueur maximale du nom d'un deck, en caractères. */
export const SAVED_DECK_NAME_MAX = 30;

/**
 * - `ready` : 5 cartes, toutes encore possédées ;
 * - `incomplete` : moins de 5 cartes (deck en cours de composition) ;
 * - `invalid` : au moins une carte n'est plus dans la collection.
 */
export type SavedDeckStatus = "ready" | "incomplete" | "invalid";

/** État d'un deck enregistré : `cards` les exemplaires notés, `missing` ceux qui ne sont plus possédés. */
export function savedDeckStatus(cards: number, missing: number): SavedDeckStatus {
  if (missing > 0) return "invalid";
  return cards >= DECK_SIZE ? "ready" : "incomplete";
}

/** Nom d'un deck nettoyé (espaces superflus retirés) ; null s'il est vide. */
export function savedDeckName(name: string): string | null {
  const clean = name.replace(/\s+/g, " ").trim();
  return clean ? [...clean].slice(0, SAVED_DECK_NAME_MAX).join("") : null;
}
