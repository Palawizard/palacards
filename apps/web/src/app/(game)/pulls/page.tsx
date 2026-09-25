"use client";

import {
  CARDS_PER_PACK,
  DROP_TABLE_GUARANTEED,
  DROP_TABLE_STANDARD,
  DROP_TABLE_TOTAL,
  ECONOMY,
  RARITIES,
  RARITY_LABELS,
} from "@palacards/game";
import { useState } from "react";
import { toast } from "sonner";
import { RaritySigil } from "@/components/Card";
import { PackOpener } from "@/components/PackOpener";
import { api, ApiError } from "@/lib/api";
import { countdown } from "@/lib/format";
import { useMe } from "@/lib/game";
import { usePackCountdown } from "@/lib/packs";

const SPEEDS = [
  { value: "normal", label: "Animée" },
  { value: "fast", label: "Rapide" },
  { value: "instant", label: "Instantanée" },
] as const;

const pct = (bp: number) =>
  `${((bp / DROP_TABLE_TOTAL) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

/** Jauge du stock : une case par paquet, groupées par dix comme les rangées d'une planche. */
function StockGauge({ available, max }: { available: number; max: number }) {
  const groups = Array.from({ length: Math.ceil(max / 10) }, (_, g) =>
    Array.from({ length: Math.min(10, max - g * 10) }, (_, i) => g * 10 + i),
  );
  return (
    <span className="flex gap-1.5" aria-hidden>
      {groups.map((group, g) => (
        <span key={g} className="flex gap-[2px]">
          {group.map((i) => (
            <span
              key={i}
              className={`h-3.5 w-[5px] rounded-[2px] transition-colors duration-300 ${
                i < available ? "bg-accent shadow-[inset_0_0_0_1px_rgb(90_60_0/0.25)]" : "border border-line-strong"
              }`}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

export default function PullsPage() {
  const { me, mutateMe } = useMe();
  const { remaining, full } = usePackCountdown(me?.packs);
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState(false);

  async function buyBonus() {
    setBuying(true);
    try {
      await api("/packs/buy", { method: "POST" });
      toast.success("Paquet bonus ajouté à ton stock.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Achat impossible.");
    } finally {
      setBuying(false);
    }
  }

  async function setSpeed(value: (typeof SPEEDS)[number]["value"]) {
    if (!me || me.animationSpeed === value) return;
    setSaving(true);
    try {
      await mutateMe(api("/me/settings", { method: "PATCH", body: { animationSpeed: value } }), { revalidate: false });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Réglage non enregistré.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <h1 className="page-title">Paquets</h1>
        {me ? (
          <dl className="tnum flex flex-wrap items-end gap-x-6 gap-y-2 text-sm">
            <div title={`Stock : ${me.packs.available}/${me.packs.max}`}>
              <dt className="text-xs font-semibold text-faint">Stock</dt>
              <dd className="flex items-center gap-2">
                <span className="font-display text-2xl leading-none">
                  {me.packs.available}
                  <span className="text-faint">/{me.packs.max}</span>
                </span>
                <StockGauge available={me.packs.available} max={me.packs.max} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-faint">Prochain</dt>
              <dd className="font-display text-2xl leading-none">{full ? "Plein" : countdown(remaining)}</dd>
            </div>
            <div title="Paquets ouverts depuis la dernière UR ou légendaire">
              <dt className="text-xs font-semibold text-faint">Pity</dt>
              <dd className="flex items-center gap-2">
                <span className="font-display text-2xl leading-none">
                  {me.packs.pity}
                  <span className="text-faint">/{me.packs.pityThreshold}</span>
                </span>
                <span className="h-2 w-16 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-rarity-ur transition-[width] duration-500"
                    style={{ width: `${Math.min(100, (me.packs.pity / me.packs.pityThreshold) * 100)}%` }}
                  />
                </span>
              </dd>
            </div>
            {me.packs.bonus > 0 && (
              <div>
                <dt className="text-xs font-semibold text-faint">Bonus</dt>
                <dd className="font-display text-2xl leading-none text-highlight">+{me.packs.bonus}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="hatnote">Chargement du stock…</p>
        )}
      </header>

      <div className="flex flex-col gap-10">
        <div className="min-w-0">
          {me && <PackOpener packs={me.packs} season={me.season} />}
          {me && me.packs.available + me.packs.bonus === 0 && (
            <p className="mt-4 text-center text-sm text-muted">
              Plus de paquet pour l’instant. Le prochain arrive dans{" "}
              <span className="tnum">{countdown(remaining)}</span>.
            </p>
          )}
        </div>

        <aside className="grid items-start gap-4 md:grid-cols-[minmax(0,15rem)_minmax(0,24rem)] md:justify-center">
          <div className="infobox">
            <h2 className="infobox-head">Ouverture</h2>
            <div className="flex flex-col gap-2 p-3" role="radiogroup" aria-label="Vitesse d'ouverture">
              {SPEEDS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={me?.animationSpeed === s.value}
                  disabled={saving || !me}
                  onClick={() => setSpeed(s.value)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-panel-2 aria-checked:text-text [&:not([aria-checked=true])]:text-muted"
                >
                  <span className="grid size-4 place-items-center rounded-full border border-line-strong">
                    {me?.animationSpeed === s.value && <span className="size-2 rounded-full bg-accent" />}
                  </span>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="border-t border-line p-3">
              <button
                type="button"
                className="btn btn-sm h-auto w-full justify-between whitespace-normal py-1.5 text-left leading-tight"
                disabled={buying || !me || me.wallet.available < ECONOMY.bonusPackPrice}
                onClick={buyBonus}
                title={me && me.wallet.available < ECONOMY.bonusPackPrice ? "Pas assez de points wiki" : undefined}
              >
                <span>Acheter un paquet bonus</span>
                <span className="tnum shrink-0">{ECONOMY.bonusPackPrice} PW</span>
              </button>
            </div>
          </div>

          <div className="infobox">
            <h2 className="infobox-head">Taux de tirage</h2>
            <table className="tnum w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="px-3 py-1.5 font-semibold">Rareté</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Cartes 1–{CARDS_PER_PACK - 1}</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Carte {CARDS_PER_PACK}</th>
                </tr>
              </thead>
              <tbody>
                {[...RARITIES].reverse().map((r) => (
                  <tr key={r} className="border-t border-line">
                    <td className="px-3 py-1.5">
                      <RaritySigil rarity={r} />
                      <span className="sr-only">{RARITY_LABELS[r]}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {DROP_TABLE_STANDARD[r] ? pct(DROP_TABLE_STANDARD[r]) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {DROP_TABLE_GUARANTEED[r] ? pct(DROP_TABLE_GUARANTEED[r]) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {me && (
              <div className="border-t border-line p-3 text-sm">
                <p className="text-xs leading-relaxed text-faint">
                  {CARDS_PER_PACK} cartes par paquet, la dernière Rare ou mieux. Pity : après {me.packs.pityThreshold}{" "}
                  paquets sans UR ni légendaire, la dernière carte du suivant est forcément UR ou mieux. Un paquet bonus
                  coûte {ECONOMY.bonusPackPrice} PW.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
