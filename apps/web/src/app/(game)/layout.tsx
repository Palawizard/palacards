import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { GameProvider, SwrProvider } from "@/lib/game";

/** `modal` : créneau des fenêtres superposées (fiche carte interceptée, voir @modal). */
export default function GameLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <SwrProvider>
      <GameProvider>
        <Shell>{children}</Shell>
        {modal}
      </GameProvider>
    </SwrProvider>
  );
}
