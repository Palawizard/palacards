"use client";

import { Toaster as Sonner } from "sonner";
import { useResolvedTheme } from "@/lib/theme";

/** Toasts aux couleurs du thème affiché (y compris un thème forcé différent du système). */
export function Toaster() {
  return (
    <Sonner
      theme={useResolvedTheme()}
      position="bottom-center"
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
