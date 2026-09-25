"use client";

import { useSyncExternalStore } from "react";

/** Thème choisi sur cet appareil ; « system » suit le réglage du système. */
export type ThemePref = "system" | "light" | "dark";

export const THEME_KEY = "palacards-theme";

/** Script inline du <head> : applique le thème choisi avant le premier rendu (pas de flash). */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const listeners = new Set<() => void>();

function read(): ThemePref {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

export function setTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Stockage indisponible (navigation privée) : le choix vaut pour cette page seulement.
  }
  listeners.forEach((l) => l());
}

export function useTheme(): ThemePref {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    read,
    () => "system",
  );
}
