"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

/**
 * Option « flouter les arthropodes » : quelles cartes montrent une araignée, un insecte… Demandé au serveur
 * par lots (les cartes affichées dans la même image), seulement quand l'option est active, et gardé pour
 * la session. Une image dévoilée d'un clic le reste partout jusqu'au rechargement.
 */
const flags = new Map<number, boolean>();
const revealed = new Set<number>();
const listeners = new Set<() => void>();
const queue = new Set<number>();
const inflight = new Set<number>();
let timer: ReturnType<typeof setTimeout> | null = null;

const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Drapeau arrivé avec l'image de la carte (`card:media`, après un tirage). */
export function setArthropodFlag(cardId: number, arthropod: boolean) {
  if (flags.get(cardId) === arthropod) return;
  flags.set(cardId, arthropod);
  notify();
}

export function revealArthropod(cardId: number) {
  revealed.add(cardId);
  notify();
}

const BATCH = 200;

async function flush() {
  timer = null;
  const ids = [...queue].slice(0, BATCH);
  ids.forEach((id) => (queue.delete(id), inflight.add(id)));
  if (queue.size) timer = setTimeout(() => void flush(), 0);
  try {
    const res = await api<{ arthropods: number[]; pending: number[] }>(`/cards/arthropods?ids=${ids.join(",")}`);
    const yes = new Set(res.arthropods);
    const later = new Set(res.pending);
    // En attente : pas encore de résumé, donc pas d'image ; le drapeau arrivera avec elle par socket.
    for (const id of ids) if (!later.has(id)) flags.set(id, yes.has(id));
  } catch {
    // Réponse impossible : on garde l'image voilée, mais toujours dévoilable d'un clic.
    for (const id of ids) if (!flags.has(id)) flags.set(id, true);
  } finally {
    ids.forEach((id) => inflight.delete(id));
    notify();
  }
}

function request(cardId: number) {
  if (flags.has(cardId) || inflight.has(cardId) || queue.has(cardId)) return;
  queue.add(cardId);
  // Un court délai rassemble toutes les cartes d'une grille en une requête.
  timer ??= setTimeout(() => void flush(), 16);
}

/**
 * État de l'image d'une carte : `off` (option coupée ou pas d'image), `pending` (on ne sait pas encore :
 * image retenue), `veiled` (arthropode, floutée), `shown` (pas un arthropode, ou dévoilée d'un clic).
 */
export type VeilState = "off" | "pending" | "veiled" | "shown";

export function useArthropodVeil(cardId: number, enabled: boolean): VeilState {
  const active = enabled && cardId > 0;
  const flag = useSyncExternalStore(
    subscribe,
    () => (active ? (revealed.has(cardId) ? "revealed" : flags.get(cardId)) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (active) request(cardId);
  }, [active, cardId]);
  if (!active) return "off";
  if (flag === "revealed" || flag === false) return "shown";
  return flag === true ? "veiled" : "pending";
}
