"use client";

import type { PackState } from "@palacards/shared";
import { useEffect, useState } from "react";
import { useMe } from "./game";
import { useNow } from "./use-now";

/**
 * Compte à rebours du prochain paquet à partir de l'état reçu du serveur.
 * Quand il arrive à zéro, on relit /me : le serveur reste la source de vérité.
 */
export function usePackCountdown(packs: PackState | undefined) {
  const now = useNow(1000);
  const { mutateMe } = useMe();
  const [anchor, setAnchor] = useState<{ packs: PackState | undefined; at: number }>({ packs, at: now });
  if (anchor.packs !== packs) setAnchor({ packs, at: now });
  const full = !packs || packs.available >= packs.max;
  const remaining = packs && !full ? Math.max(0, packs.nextInMs - (now - anchor.at)) : 0;
  const due = !full && remaining === 0;
  useEffect(() => {
    if (due) void mutateMe();
  }, [due, mutateMe]);
  return { remaining, full };
}
