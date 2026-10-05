import { useCallback, useSyncExternalStore } from "react";

const EVENT = "pc-stored-flag";

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // Stockage indisponible (navigation privée…) : réglage par défaut.
    return false;
  }
}

/**
 * Interrupteur gardé sur l'appareil (localStorage), faux par défaut et côté serveur : pas de décalage
 * d'hydratation, et les autres onglets suivent.
 */
export function useStoredFlag(key: string): [boolean, (v: boolean) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("storage", onChange);
    window.addEventListener(EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(EVENT, onChange);
    };
  }, []);
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (v: boolean) => {
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        // idem
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}
