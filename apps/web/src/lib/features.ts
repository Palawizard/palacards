"use client";

import { useEffect } from "react";
import { api } from "./api";
import { useMe } from "./game";

/** Première visite d'une nouveauté : la pastille « Nouveau » du menu disparaît (sur tous les appareils). */
export function useSeenFeature(key: string) {
  const { me, mutateMe } = useMe();
  const unseen = !!me?.newFeatures.includes(key);
  useEffect(() => {
    if (!unseen) return;
    void mutateMe((m) => (m ? { ...m, newFeatures: m.newFeatures.filter((f) => f !== key) } : m), {
      revalidate: false,
    });
    void api("/me/seen-feature", { body: { key } }).catch(() => {});
  }, [unseen, key, mutateMe]);
}
