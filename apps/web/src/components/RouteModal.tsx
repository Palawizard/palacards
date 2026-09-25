"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./route-modal.css";

const noop = () => () => {};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Ce qui reste utilisable sous la fenêtre : les toasts (sonner) et les scripts. */
const keepInteractive = (el: Element) =>
  el.tagName === "SCRIPT" || (el.tagName === "SECTION" && el.getAttribute("aria-label")?.startsWith("Notifications"));

/**
 * Fenêtre superposée d'une route interceptée (fiche carte ouverte depuis une vignette).
 * L'écran d'origine reste monté dessous : une ouverture de paquet continue là où on l'a laissée.
 * Fermeture : bouton, Échap, clic sur le fond ou « retour » du navigateur (l'URL de la fiche est dans l'historique).
 * Pas de <dialog> natif : sa couche supérieure masquerait les toasts des actions faites dans la fiche.
 */
export function RouteModal({ children }: { children: (titleId: string) => ReactNode }) {
  const router = useRouter();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  // Rendu côté client seulement : la fenêtre est portée directement dans <body>.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  useEffect(() => {
    const host = backdrop.current;
    if (!host) return;
    const previous = document.activeElement as HTMLElement | null;
    // Le reste de la page devient inerte (ni focus, ni lecteur d'écran) et ne défile plus.
    const inert = ([...document.body.children] as HTMLElement[]).filter(
      (el) => el !== host && !keepInteractive(el) && !el.inert,
    );
    for (const el of inert) el.inert = true;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    const gutter = root.style.scrollbarGutter;
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => {
      for (const el of inert) el.inert = false;
      root.style.overflow = overflow;
      root.style.scrollbarGutter = gutter;
      previous?.focus?.({ preventScroll: true });
    };
  }, [mounted]);

  const close = () => router.back();

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Une boîte de confirmation ouverte dans la fiche gère son propre Échap.
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!mounted) return null;
  return createPortal(
    <div ref={backdrop} className="pc-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="pc-sheet"
      >
        <button type="button" className="pc-sheet-close" onClick={close} aria-label="Fermer la fiche">
          <X aria-hidden className="size-5" />
        </button>
        <div className="pc-sheet-body">{children(titleId)}</div>
      </div>
    </div>,
    document.body,
  );
}
