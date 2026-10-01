"use client";

import { useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/game";

/** Première visite du nouveau mode bataille : la pastille « Nouveau » du menu disparaît (tous appareils). */
export default function BattleLayout({ children }: { children: ReactNode }) {
  const { me, mutateMe } = useMe();
  const unseen = !!me?.newFeatures.includes("battle-v2");
  useEffect(() => {
    if (!unseen) return;
    void mutateMe((m) => (m ? { ...m, newFeatures: m.newFeatures.filter((f) => f !== "battle-v2") } : m), {
      revalidate: false,
    });
    void api("/me/seen-feature", { body: { key: "battle-v2" } }).catch(() => {});
  }, [unseen, mutateMe]);
  return children;
}
