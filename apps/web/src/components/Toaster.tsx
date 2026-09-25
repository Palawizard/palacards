"use client";

import { Toaster as Sonner } from "sonner";
import { useResolvedTheme } from "@/lib/theme";
import { PHONE_QUERY, useMediaQuery } from "@/lib/use-media-query";

/**
 * Toasts aux couleurs du thème affiché (y compris un thème forcé différent du système). Sur téléphone,
 * ils descendent sous la barre du haut : en bas, ils couvriraient les boutons du pouce (« Suivante »…).
 */
export function Toaster() {
  const phone = useMediaQuery(PHONE_QUERY);
  return (
    <Sonner
      theme={useResolvedTheme()}
      position={phone ? "top-center" : "bottom-center"}
      mobileOffset={{ top: 64, left: 12, right: 12 }}
      toastOptions={{
        style: {
          background: "var(--color-panel-2)",
          border: "1px solid var(--color-line-strong)",
          borderRadius: "12px",
          color: "var(--color-text)",
          fontFamily: "var(--font-sans)",
        },
      }}
    />
  );
}
