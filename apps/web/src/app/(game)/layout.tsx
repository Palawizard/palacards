import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BroadcastOverlay } from "@/components/BroadcastOverlay";
import { Shell } from "@/components/Shell";
import { GameProvider, SwrProvider } from "@/lib/game";

// Pages derrière la connexion : rien à indexer.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** `modal` : créneau des fenêtres superposées (fiche carte interceptée, voir @modal). */
export default function GameLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <SwrProvider>
      <GameProvider>
        <Shell>{children}</Shell>
        {modal}
        <BroadcastOverlay />
      </GameProvider>
    </SwrProvider>
  );
}
