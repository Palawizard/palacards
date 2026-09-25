"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Vrai tant que la media query correspond. Faux au rendu serveur (le client corrige à l'hydratation). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  );
}

/** Téléphone : sous le point de rupture `sm` de Tailwind (640 px). */
export const PHONE_QUERY = "(max-width: 639.98px)";
