"use client";

import { useEffect, useId, useRef } from "react";
import { play, setSfxEnabled, setSfxVolume, useSfxEnabled, useSfxVolume } from "@/lib/sfx";

/** Délai avant le son d'essai : on attend que le curseur se pose au lieu de jouer à chaque cran. */
const PREVIEW_DELAY_MS = 180;

/**
 * Sons du jeu : activés ou coupés (le même réglage que le bouton de l'en-tête) et volume de 0 à
 * 100 %, retenus sur l'appareil. À 0 %, plus rien ne joue et la case se décoche.
 */
export function SoundSettings() {
  const on = useSfxEnabled();
  const volume = useSfxVolume();
  const id = useId();
  const preview = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(preview.current), []);

  return (
    <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-panel">
      <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
        <span>Sons du jeu</span>
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-accent)]"
          checked={on}
          onChange={(e) => setSfxEnabled(e.target.checked)}
        />
      </label>
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id}>Volume</label>
          <output htmlFor={id} className="tnum text-sm text-muted">
            {volume}&nbsp;%
          </output>
        </div>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={5}
          value={volume}
          aria-valuetext={`${volume} %`}
          className="h-6 w-full cursor-pointer accent-[var(--color-accent)]"
          onChange={(e) => {
            const v = Number(e.target.value);
            setSfxVolume(v);
            clearTimeout(preview.current);
            if (v > 0) preview.current = setTimeout(() => play("coin"), PREVIEW_DELAY_MS);
          }}
        />
      </div>
    </div>
  );
}
