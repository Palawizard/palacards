"use client";

import type { CommunityGoalDTO } from "@palacards/shared";
import { Check, Users } from "lucide-react";
import useSWR from "swr";
import { fmt } from "@/lib/format";
import { useSocketEvent } from "@/lib/game";

const NBSP = String.fromCharCode(160);

/** Récompense d'un palier, en toutes lettres. */
function rewardText(t: { pw: number; packs: number }) {
  return [`${fmt(t.pw)}${NBSP}PW`, t.packs ? `${t.packs}${NBSP}paquet${t.packs > 1 ? "s" : ""} bonus` : ""]
    .filter(Boolean)
    .join(" + ");
}

/** « il y a 4 min » : âge du compteur en cache. */
function age(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 1 ? "à l’instant" : `il y a ${min}${NBSP}min`;
}

/**
 * Objectif communautaire de la saison (suggestion n° 105) : articles différents tirés par au moins un joueur,
 * barre graduée jusqu'au dernier palier, chiffre exact, récompense de chaque palier et ce qui est déjà versé.
 */
export function CommunityGoal() {
  const { data, mutate } = useSWR<CommunityGoalDTO>("/community-goal", { refreshInterval: 5 * 60_000 });
  useSocketEvent("notification:new", (n) => {
    if (n.type === "community_goal") void mutate();
  });
  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-panel" aria-hidden />;

  const last = data.tiers[data.tiers.length - 1]!.cards;
  const pos = (n: number) => Math.min(1, n / last);
  const next = data.tiers[data.tiersReached];

  return (
    <section className="infobox" aria-labelledby="community-title">
      <h2 id="community-title" className="infobox-head flex items-center gap-2">
        <Users aria-hidden className="size-4" strokeWidth={2.5} />
        Objectif communautaire · saison {data.season}
      </h2>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-muted">
            <strong className="tnum font-display text-3xl uppercase leading-none text-text">
              {fmt(data.distinctCards)}
            </strong>{" "}
            cartes différentes tirées par la communauté
            {data.seasonCards > 0 && <span className="tnum"> sur {fmt(data.seasonCards)}</span>}
          </p>
          <p className="tnum text-xs text-faint">
            {data.computedAt ? `Compté ${age(data.computedAt)}` : "Premier comptage en cours…"}
          </p>
        </div>

        {/* Barre graduée : un repère par palier, rempli jusqu'au compteur. */}
        <div className="relative pb-7 pt-1">
          <div
            className="h-3 overflow-hidden rounded-full bg-panel-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={last}
            aria-valuenow={Math.min(data.distinctCards, last)}
            aria-valuetext={`${fmt(data.distinctCards)} cartes différentes, ${data.tiersReached} palier${data.tiersReached > 1 ? "s" : ""} sur ${data.tiers.length}`}
            aria-label="Progression de l’objectif communautaire"
          >
            <div
              className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-(--ease-out)"
              style={{ transform: `scaleX(${pos(data.distinctCards)})` }}
            />
          </div>
          {data.tiers.map((t, i) => (
            <span
              key={t.cards}
              aria-hidden
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${pos(t.cards) * 100}%` }}
            >
              <span
                className={`block h-5 w-0.5 rounded-full ${i < data.tiersReached ? "bg-accent-ink/60" : "bg-line-strong"}`}
              />
              <span
                className={`tnum mt-1 whitespace-nowrap text-[11px] font-semibold ${i === data.tiers.length - 1 ? "-translate-x-1/3" : ""} ${i < data.tiersReached ? "text-text" : "text-faint"} ${i === 1 ? "max-sm:hidden" : ""}`}
              >
                {t.cards >= 1_000_000 ? `${fmt(t.cards / 1_000_000)}${NBSP}M` : `${fmt(t.cards / 1000)}${NBSP}k`}
              </span>
            </span>
          ))}
        </div>

        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Paliers et récompenses">
          {data.tiers.map((t, i) => {
            const reached = i < data.tiersReached;
            const paid = data.rewardedTiers.includes(i + 1);
            return (
              <li
                key={t.cards}
                className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm ${reached ? "border-accent bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)]" : "border-line"}`}
              >
                <span className="tnum font-semibold text-text">{fmt(t.cards)} cartes</span>
                <span className="tnum text-muted">{rewardText(t)}</span>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-bold ${paid ? "text-good" : "text-faint"}`}
                >
                  {paid && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
                  {paid ? "Reçu" : reached ? (data.eligible ? "Atteint, versement en cours" : "Atteint") : "À venir"}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="text-xs text-faint">
          {next
            ? `Prochain palier${NBSP}: encore ${fmt(next.cards - data.distinctCards)} cartes différentes. `
            : "Tous les paliers sont atteints. "}
          {data.eligible
            ? "Chaque palier atteint te rapporte sa récompense une fois, même si tu n’étais pas là."
            : "Ouvre au moins un paquet cette saison pour toucher les récompenses des paliers."}{" "}
          Le compteur repart de zéro à chaque nouvelle saison.
        </p>
      </div>
    </section>
  );
}
