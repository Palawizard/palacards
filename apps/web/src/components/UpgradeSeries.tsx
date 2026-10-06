"use client";

import { RARITY_LABELS, type Rarity } from "@palacards/game";
import type { UpgradeSeriesPreviewDTO, UpgradeSeriesResultDTO } from "@palacards/shared";
import { Layers, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Card } from "@/components/Card";
import { chanceText } from "@/components/UpgradeDial";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { play } from "@/lib/sfx";

const NBSP = String.fromCharCode(160);
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const plural = (n: number, one: string, many: string) => `${fmt(n)}${NBSP}${n > 1 ? many : one}`;
const decimal = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/**
 * Upgrade en série : tous les doublons d'une rareté partent en lots au rendement maximal, en un clic.
 * Aperçu d'abord (lots, réussites attendues, PW rendus au pire), puis récapitulatif des cartes gagnées.
 * Case « dernier exemplaire » : décochée à chaque visite et à chaque changement de rareté, avec le nombre de
 * cartes qui quitteraient la collection.
 */
export function UpgradeSeries({ rarity, disabled, onDone }: { rarity: Rarity; disabled: boolean; onDone: () => void }) {
  const reduce = useReducedMotion();
  const { mutateMe } = useMe();
  const [singlesFor, setSinglesFor] = useState<Rarity | null>(null);
  const singles = singlesFor === rarity;
  const preview = useSWR<UpgradeSeriesPreviewDTO>(`/upgrade/series?rarity=${rarity}${singles ? "&singles=1" : ""}`, {
    keepPreviousData: true,
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UpgradeSeriesResultDTO | null>(null);
  const shown = result?.rarity === rarity ? result : null;
  // Ancien aperçu gardé pendant le rechargement (case cochée) : seulement s'il est de cette rareté.
  const p = preview.data?.rarity === rarity ? preview.data : undefined;
  const lots = p?.lots ?? [];

  async function run() {
    if (!p || !lots.length || running) return;
    setRunning(true);
    play("tear");
    try {
      const res = await api<UpgradeSeriesResultDTO>("/upgrade/series", { body: { rarity, singles } });
      setResult(res);
      play(res.successes ? "coin" : "wrong");
      void mutateMe((m) => (m ? { ...m, wallet: res.wallet } : m), { revalidate: false });
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Upgrade en série impossible.");
    } finally {
      setRunning(false);
      void preview.mutate();
    }
  }

  const full = lots.filter((l) => l.cards === lots[0]?.cards).length;
  const rest = lots.length > full ? lots[lots.length - 1] : null;

  return (
    <section className="infobox" aria-labelledby="serie-title" aria-busy={running}>
      <h2 id="serie-title" className="infobox-head flex items-center gap-2">
        <Layers aria-hidden className="size-4" strokeWidth={2.5} />
        Upgrade en série
      </h2>
      <div className="flex flex-col gap-4 p-4">
        {!p ? (
          <div className="h-12 animate-pulse rounded-lg bg-bg" aria-hidden />
        ) : lots.length === 0 ? (
          <p className="text-sm text-muted">
            {singles ? (
              <>Aucune carte de rareté {RARITY_LABELS[rarity].toLowerCase()} à upgrader.</>
            ) : (
              <>
                Aucun doublon de rareté {RARITY_LABELS[rarity].toLowerCase()} à upgrader. Le meilleur exemplaire de
                chaque carte, les favoris, les brillantes et les cartes engagées ne partent jamais en série.
              </>
            )}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-text">
                {singles ? plural(p.cards, "carte", "cartes") : plural(p.cards, "doublon", "doublons")} →{" "}
                {plural(lots.length, "upgrade", "upgrades")}{" "}
                <span className="font-normal text-muted">
                  ({full} × {lots[0]!.cards} cartes à {chanceText(lots[0]!.chance)}
                  {NBSP}%
                  {rest ? ` + 1 × ${plural(rest.cards, "carte", "cartes")} à ${chanceText(rest.chance)}${NBSP}%` : ""})
                </span>
              </p>
              <p className="tnum mt-1 text-muted">
                ≈ {decimal(p.expectedSuccesses)} {RARITY_LABELS[p.target].toLowerCase()}
                {p.expectedSuccesses >= 2 ? "s" : ""} attendue{p.expectedSuccesses >= 2 ? "s" : ""} · au pire +
                {fmt(p.refundIfAllFail)}
                {NBSP}PW
                {p.available > p.cards &&
                  ` · ${fmt(p.available - p.cards)} ${singles ? "cartes" : "doublons"} au prochain lancement`}
              </p>
              <p className="mt-1 text-xs text-faint">
                {singles
                  ? "Jamais les favoris, les brillantes ni les cartes engagées."
                  : "Jamais le meilleur exemplaire d’une carte, ni les favoris, les brillantes ou les cartes engagées."}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary max-sm:w-full"
              disabled={disabled || running}
              onClick={run}
            >
              {running ? "Upgrades en cours…" : `Lancer ${plural(lots.length, "upgrade", "upgrades")}`}
            </button>
          </div>
        )}

        {p && (p.singles > 0 || singles) && (
          <div className="flex flex-col gap-2">
            <label className="flex w-fit items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={singles}
                disabled={running}
                onChange={(e) => setSinglesFor(e.target.checked ? rarity : null)}
              />
              Inclure le dernier exemplaire de chaque carte
            </label>
            <AnimatePresence initial={false}>
              {singles && p.singlesUsed > 0 && (
                <motion.p
                  key="warning"
                  role="status"
                  className="flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-sm text-text"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(-4px)" }}
                  animate={{ opacity: 1, transform: "translateY(0px)" }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                >
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2.5} />
                  <span>
                    <strong>
                      {p.singlesUsed} carte{p.singlesUsed > 1 ? "s vont" : " va"} quitter ta collection
                    </strong>
                    {NBSP}: c’est ton dernier exemplaire{p.singlesUsed > 1 ? " de chacune" : ""}.
                  </span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}

        {shown && (
          <div className="border-t-2 border-dashed border-line pt-4" aria-live="polite">
            <p className="tnum text-sm">
              <strong className="text-text">
                {shown.successes} réussite{shown.successes > 1 ? "s" : ""} sur {shown.lots.length}
              </strong>
              <span className="text-muted">{shown.refund ? ` · +${fmt(shown.refund)}${NBSP}PW récupérés` : ""}</span>
            </p>
            {shown.cards.length > 0 && (
              <ol className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
                {shown.cards.map((card, i) => (
                  <motion.li
                    key={card.instanceId}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px) scale(0.96)" }}
                    animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
                    transition={{ duration: 0.26, ease: EASE_OUT, delay: Math.min(i, 8) * 0.04 }}
                  >
                    <Card card={card} href={`/card/${card.cardId}`} />
                  </motion.li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
