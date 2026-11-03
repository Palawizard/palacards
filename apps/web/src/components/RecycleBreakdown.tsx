"use client";

import type { Rarity } from "@palacards/game";
import { RaritySigil } from "@/components/Card";
import { fmt } from "@/lib/format";

/**
 * Détail d'un recyclage dans sa fenêtre de confirmation : cartes par rareté (de la plus commune à la plus rare,
 * comme `countByRarity`), puis le total de points wiki.
 */
export function RecycleBreakdown({ rarities, gain }: { rarities: { rarity: Rarity; count: number }[]; gain: number }) {
  return (
    <dl className="tnum mt-3 rounded-lg border border-line text-text">
      {rarities.map(({ rarity, count }) => (
        <div key={rarity} className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
          <dt>
            <RaritySigil rarity={rarity} withLabel />
          </dt>
          <dd>× {fmt(count)}</dd>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 font-semibold">
        <dt>Total</dt>
        <dd>+{fmt(gain)} PW</dd>
      </div>
    </dl>
  );
}
