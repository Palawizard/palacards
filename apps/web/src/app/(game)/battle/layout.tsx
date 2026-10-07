"use client";

import type { ReactNode } from "react";
import { useSeenFeature } from "@/lib/features";

/** Première visite du mode bataille et des decks enregistrés : la pastille « Nouveau » du menu disparaît. */
export default function BattleLayout({ children }: { children: ReactNode }) {
  useSeenFeature("battle-v2");
  useSeenFeature("battle-decks");
  return children;
}
