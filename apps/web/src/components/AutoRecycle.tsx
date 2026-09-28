"use client";

import { AUTO_RECYCLE_RARITIES, ECONOMY, RARITY_LABELS, rarityRank, type AutoRecycleRarity } from "@palacards/game";
import type { MeDTO } from "@palacards/shared";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/game";

/**
 * Recyclage automatique : les sigles servent de curseur (tout ce qui est au plus à la rareté choisie
 * part au recyclage dès l'ouverture d'un paquet), plus « garder les nouvelles cartes ».
 */
export function AutoRecycle() {
  const { me, mutateMe } = useMe();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const { max, keepNew } = me.autoRecycle;

  async function save(body: { autoRecycleMax?: AutoRecycleRarity | null; autoRecycleKeepNew?: boolean }) {
    setBusy(true);
    try {
      await mutateMe(api<MeDTO>("/me/settings", { method: "PATCH", body }), {
        optimisticData: (m) => ({
          ...m!,
          autoRecycle: {
            max: body.autoRecycleMax === undefined ? m!.autoRecycle.max : body.autoRecycleMax,
            keepNew: body.autoRecycleKeepNew ?? m!.autoRecycle.keepNew,
          },
        }),
        rollbackOnError: true,
        revalidate: false,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Réglage non enregistré.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="radiogroup"
        aria-label="Recyclage automatique"
        data-active={max !== null || undefined}
      >
        <button
          type="button"
          role="radio"
          aria-checked={max === null}
          disabled={busy}
          className="chip aria-checked:border-accent aria-checked:bg-accent aria-checked:text-accent-ink"
          onClick={() => max !== null && save({ autoRecycleMax: null })}
          aria-label="Recyclage automatique désactivé"
        >
          Non
        </button>
        {AUTO_RECYCLE_RARITIES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={max === r}
            aria-label={`Jusqu’à ${RARITY_LABELS[r]}`}
            title={`Recycler jusqu’à ${RARITY_LABELS[r]} (+${ECONOMY.recycleValue[r]} PW la carte)`}
            disabled={busy}
            className="rarity-toggle"
            data-rarity={r}
            // Le seuil choisi et tout ce qui est en dessous : le palier entier est « allumé ».
            data-on={(max !== null && rarityRank(r) <= rarityRank(max)) || undefined}
            onClick={() => max !== r && save({ autoRecycleMax: r })}
          >
            {r}
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-faint">
        {max === null
          ? "Toutes les cartes tirées restent dans ta collection."
          : `À l’ouverture, les cartes ${max === "C" ? "communes" : `de ${RARITY_LABELS.C.toLowerCase()} à ${RARITY_LABELS[max].toLowerCase()}`} sont recyclées en points wiki.`}
      </p>
      <label className={`flex items-center gap-2 text-sm ${max === null ? "text-faint" : "text-muted"}`}>
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-accent)]"
          checked={keepNew}
          disabled={busy || max === null}
          onChange={(e) => save({ autoRecycleKeepNew: e.target.checked })}
        />
        Garder les cartes que je n’ai pas encore
      </label>
    </div>
  );
}
