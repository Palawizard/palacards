"use client";

import type { CardMedia } from "@palacards/shared";
import { useSyncExternalStore } from "react";

/** Images arrivées par socket après un tirage (chargées en arrière-plan côté serveur). */
const media = new Map<number, CardMedia>();
const listeners = new Set<() => void>();

export function pushMedia(m: CardMedia) {
  media.set(m.cardId, m);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useCardMedia(cardId: number): CardMedia | undefined {
  return useSyncExternalStore(
    subscribe,
    () => media.get(cardId),
    () => undefined,
  );
}
