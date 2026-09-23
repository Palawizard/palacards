import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { GameProvider, SwrProvider } from "@/lib/game";

export default function GameLayout({ children }: { children: ReactNode }) {
  return (
    <SwrProvider>
      <GameProvider>
        <Shell>{children}</Shell>
      </GameProvider>
    </SwrProvider>
  );
}
