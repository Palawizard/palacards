"use client";

import { IMAGE_THEMES, type ImageTheme } from "@palacards/game";
import type { MeDTO } from "@palacards/shared";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

/**
 * Filtres d'images (suggestion n° 111, généralise « flouter les arthropodes ») : thèmes de chaque carte
 * (arthropodes, blessures et maladies, nudité), demandés au serveur par lots (les cartes affichées dans la même
 * image), seulement quand un filtre est actif, et gardés pour la session. Une image dévoilée d'un clic le reste
 * partout jusqu'au rechargement.
 */
const flags = new Map<number, readonly ImageTheme[]>();
const revealed = new Set<number>();
const listeners = new Set<() => void>();
const queue = new Set<number>();
const inflight = new Set<number>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** Réponse impossible : on garde l'image voilée, mais toujours dévoilable d'un clic. */
const UNKNOWN: readonly ImageTheme[] = IMAGE_THEMES;
const NONE: readonly ImageTheme[] = [];

const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Thèmes arrivés avec l'image de la carte (`card:media`, après un tirage). */
export function setImageThemes(cardId: number, themes: readonly ImageTheme[]) {
  const prev = flags.get(cardId);
  if (prev && prev.length === themes.length && prev.every((t, i) => t === themes[i])) return;
  flags.set(cardId, themes.length ? themes : NONE);
  notify();
}

export function revealImage(cardId: number) {
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
    const res = await api<{ themes: Record<string, ImageTheme[]>; pending: number[] }>(
      `/cards/image-flags?ids=${ids.join(",")}`,
    );
    const later = new Set(res.pending);
    // En attente : pas encore de résumé, donc pas d'image ; les thèmes arriveront avec elle par socket.
    for (const id of ids) if (!later.has(id)) flags.set(id, res.themes[id] ?? NONE);
  } catch {
    for (const id of ids) if (!flags.has(id)) flags.set(id, UNKNOWN);
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

/** Thèmes que le joueur floute (Paramètres), dans l'ordre d'affichage. */
export function hiddenThemes(me: Pick<MeDTO, "hideArthropods" | "hideGore" | "hideNudity"> | undefined): ImageTheme[] {
  if (!me) return [];
  return IMAGE_THEMES.filter((t) =>
    t === "arthropods" ? me.hideArthropods : t === "gore" ? me.hideGore : me.hideNudity,
  );
}

/**
 * État de l'image d'une carte : `off` (aucun filtre actif ou pas d'image), `pending` (on ne sait pas encore :
 * image retenue), `veiled` (thème floué, avec `theme` pour la mention), `shown` (rien à flouter, ou dévoilée).
 */
export type VeilState = "off" | "pending" | "veiled" | "shown";

export function useImageVeil(
  cardId: number,
  hidden: readonly ImageTheme[],
): { state: VeilState; theme: ImageTheme | null } {
  const active = hidden.length > 0 && cardId > 0;
  const flag = useSyncExternalStore(
    subscribe,
    () => (active ? (revealed.has(cardId) ? "revealed" : flags.get(cardId)) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (active) request(cardId);
  }, [active, cardId]);
  const key = hidden.join();
  return useMemo(() => {
    if (!active) return { state: "off", theme: null };
    if (flag === "revealed") return { state: "shown", theme: null };
    if (flag === undefined) return { state: "pending", theme: null };
    const theme = hidden.find((t) => flag.includes(t)) ?? null;
    return { state: theme ? "veiled" : "shown", theme };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hidden` comparé par son contenu (`key`)
  }, [active, flag, key]);
}
