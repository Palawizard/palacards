"use client";

import {
  nextRarity,
  RARITY_LABELS,
  upgradeChance,
  upgradeSeriesLots,
  upgradeSeriesSummary,
  type Rarity,
} from "@palacards/game";
import type {
  UpgradeSeriesCardDTO,
  UpgradeSeriesLotDTO,
  UpgradeSeriesPreviewDTO,
  UpgradeSeriesResultDTO,
  UpgradeSeriesRunDTO,
} from "@palacards/shared";
import { Heart, History, Layers, Plus, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Card, SparkStar } from "@/components/Card";
import { ConfirmDialog } from "@/components/ui";
import { chanceText } from "@/components/UpgradeDial";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { play } from "@/lib/sfx";

const NBSP = String.fromCharCode(160);
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const plural = (n: number, one: string, many: string) => `${fmt(n)}${NBSP}${n > 1 ? many : one}`;
const decimal = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
/** Boutons rapides du nombre d'upgrades (affichés s'ils restent sous le maximum possible), plus « Max ». */
const QUICK_COUNTS = [1, 10, 50];
const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

/** Carte de la sélection manuelle : ce que la page sait d'un exemplaire de sa liste. */
export type SeriesPick = UpgradeSeriesCardDTO & { favorite: boolean; lastCopy: boolean };

/** Ce qui demande une confirmation avant le lancement. */
const sensitive = (c: Pick<SeriesPick, "favorite" | "shiny" | "lastCopy">) => c.favorite || c.shiny || c.lastCopy;

/** Ligne d'une carte engagée (aperçu, récapitulatif, historique) : titre, rareté, brillante, alertes. */
function SeriesCardLine({ card, onRemove }: { card: UpgradeSeriesCardDTO; onRemove?: () => void }) {
  return (
    <li data-rarity={card.rarity} className="flex min-h-9 items-center gap-2 py-1 text-sm">
      <span className="pc-sigil shrink-0" title={RARITY_LABELS[card.rarity]}>
        {card.rarity}
      </span>
      <span className="min-w-0 flex-1 truncate">{card.title}</span>
      {card.shiny && (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[#c4b5fd]">
          <SparkStar className="size-3" />
          Brillante
        </span>
      )}
      {card.favorite && (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-warn">
          <Heart aria-hidden className="size-3 fill-current" />
          Favori
        </span>
      )}
      {card.lastCopy && <span className="shrink-0 text-xs font-bold text-warn">Dernier exemplaire</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="relative grid size-7 shrink-0 place-items-center rounded-full text-muted transition-transform duration-150 after:absolute after:-inset-1.5 after:content-[''] hover:text-text active:scale-95"
          aria-label={`Retirer ${card.title} de la série`}
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </li>
  );
}

/** Récapitulatif lot par lot : cartes parties, tirage, carte obtenue ou PW rendus. */
function LotsRecap({ lots }: { lots: UpgradeSeriesLotDTO[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {lots.map((lot, i) => (
        <li key={i} className="rounded-lg border border-line bg-bg px-3 py-2">
          <details>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="tnum font-semibold text-text">Upgrade {i + 1}</span>
              <span className="tnum text-muted">
                {plural(lot.consumed.length, "carte", "cartes")} à {chanceText(lot.chance)}
                {NBSP}%
              </span>
              {lot.success && lot.won ? (
                <span className="inline-flex min-w-0 items-center gap-1.5" data-rarity={lot.won.rarity}>
                  <strong className="text-good">Réussi{NBSP}:</strong>
                  <span className="pc-sigil">{lot.won.rarity}</span>
                  <span className="truncate">{lot.won.title}</span>
                  {lot.won.shiny && <SparkStar className="size-3 shrink-0" />}
                </span>
              ) : (
                <span>
                  <strong className="text-danger">Raté</strong>
                  <span className="text-muted">{lot.refund ? ` · +${fmt(lot.refund)}${NBSP}PW` : ""}</span>
                </span>
              )}
              <span className="ml-auto text-xs text-faint">Voir les cartes</span>
            </summary>
            <ul className="mt-1 divide-y divide-line border-t border-line">
              {lot.consumed.map((c) => (
                <SeriesCardLine key={c.instanceId} card={c} />
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ol>
  );
}

/**
 * Upgrade en série : les doublons d'une rareté (ou les cartes choisies par le joueur) partent en lots au
 * rendement maximal, en un clic. Avant : la liste des cartes qui partiront (retirer, ajouter depuis la grille de
 * la page). Après : le détail de chaque upgrade, gardé dans « Dernières séries ».
 * Nombre d'upgrades au choix (champ et boutons rapides, « Max » par défaut) : ramené à ce que les cartes
 * permettent. Favoris, brillantes et derniers exemplaires : jamais pris d'office, et confirmés au lancement.
 */
export function UpgradeSeries({
  rarity,
  disabled,
  onDone,
  selection,
  onSelection,
  adding,
  onAdding,
}: {
  rarity: Rarity;
  disabled: boolean;
  onDone: () => void;
  /** Sélection manuelle (null : choix automatique). */
  selection: SeriesPick[] | null;
  onSelection: (s: SeriesPick[] | null) => void;
  /** La grille de la page ajoute à la série au lieu de l'établi. */
  adding: boolean;
  onAdding: (v: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const { mutateMe } = useMe();
  const [singlesFor, setSinglesFor] = useState<Rarity | null>(null);
  const singles = singlesFor === rarity;
  const preview = useSWR<UpgradeSeriesPreviewDTO>(`/upgrade/series?rarity=${rarity}${singles ? "&singles=1" : ""}`, {
    keepPreviousData: true,
  });
  const history = useSWR<UpgradeSeriesRunDTO[]>("/upgrade/series/history");
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<UpgradeSeriesResultDTO | null>(null);
  const shown = result?.rarity === rarity ? result : null;
  // Ancien aperçu gardé pendant le rechargement (case cochée) : seulement s'il est de cette rareté.
  const p = preview.data?.rarity === rarity ? preview.data : undefined;
  const manual = selection !== null;
  const possible = manual ? upgradeSeriesLots(rarity, selection.length).map((cards) => ({ cards })) : (p?.lots ?? []);
  // null : « Max », tous les lots possibles. `draft` : saisie en cours, validée en quittant le champ.
  const [wanted, setWanted] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const count = wanted === null ? possible.length : Math.min(wanted, possible.length);
  const lots = upgradeSeriesLots(
    rarity,
    possible.slice(0, count).reduce((s, l) => s + l.cards, 0),
  );
  const summary = upgradeSeriesSummary(rarity, lots);
  const pool: SeriesPick[] = manual
    ? selection
    : (p?.candidates ?? []).map((c) => ({ ...c, favorite: !!c.favorite, lastCopy: !!c.lastCopy }));
  const used = pool.slice(0, summary.cards);
  // Choix automatique : la case « dernier exemplaire » et son avertissement font déjà office de confirmation.
  const warned = manual ? used.filter(sensitive) : [];
  // Articles qui quitteraient la collection (en sélection manuelle, plusieurs exemplaires d'un même article comptent une fois).
  const singlesUsed = manual
    ? new Set(used.filter((c) => c.lastCopy).map((c) => c.cardId)).size
    : p
      ? Math.max(0, summary.cards - p.duplicates)
      : 0;

  function choose(n: number | null) {
    setWanted(n === null || n >= possible.length ? null : n);
    setDraft(null);
  }

  function commitDraft() {
    if (draft === null) return;
    const n = Number.parseInt(draft, 10);
    choose(n >= 1 ? n : wanted);
  }

  /** Retirer une carte : la série devient une sélection manuelle (le reste de la liste est gardé). */
  function remove(id: number) {
    onSelection(pool.filter((c) => c.instanceId !== id));
  }

  async function run() {
    if (!lots.length || running) return;
    setRunning(true);
    play("tear");
    try {
      const body = manual
        ? { rarity, instanceIds: used.map((c) => c.instanceId), confirm: warned.length > 0 }
        : { rarity, singles, lots: count };
      const res = await api<UpgradeSeriesResultDTO>("/upgrade/series", { body });
      setResult(res);
      play(res.successes ? "coin" : "wrong");
      void mutateMe((m) => (m ? { ...m, wallet: res.wallet } : m), { revalidate: false });
      onSelection(null);
      onAdding(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Upgrade en série impossible.");
    } finally {
      setRunning(false);
      void preview.mutate();
      void history.mutate();
    }
  }

  function launch() {
    if (warned.length) setConfirming(true);
    else void run();
  }

  const full = lots.filter((n) => n === lots[0]).length;
  const rest = lots.length > full ? lots[lots.length - 1] : null;
  const runs = history.data ?? [];

  return (
    <section className="infobox" aria-labelledby="serie-title" aria-busy={running}>
      <h2 id="serie-title" className="infobox-head flex items-center gap-2">
        <Layers aria-hidden className="size-4" strokeWidth={2.5} />
        Upgrade en série
      </h2>
      <div className="flex flex-col gap-4 p-4">
        {!p && !manual ? (
          <div className="h-12 animate-pulse rounded-lg bg-bg" aria-hidden />
        ) : lots.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {manual ? (
                <>Aucune carte dans ta sélection. Ajoute des cartes depuis la liste plus bas.</>
              ) : singles ? (
                <>Aucune carte de rareté {RARITY_LABELS[rarity].toLowerCase()} à upgrader.</>
              ) : (
                <>
                  Aucun doublon de rareté {RARITY_LABELS[rarity].toLowerCase()} à upgrader. Le meilleur exemplaire de
                  chaque carte, les favoris, les brillantes et les cartes engagées ne partent jamais d’office. Tu peux
                  aussi choisir tes cartes toi-même.
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-sm"
                aria-pressed={adding}
                disabled={running}
                onClick={() => {
                  if (!manual) onSelection([]);
                  onAdding(!adding);
                }}
              >
                <Plus aria-hidden className="size-4" />
                {adding ? "Terminer l’ajout" : "Choisir mes cartes"}
              </button>
              {manual && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    onSelection(null);
                    onAdding(false);
                  }}
                >
                  Revenir au choix automatique
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {possible.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="serie-count" className="text-sm font-semibold text-text">
                  Nombre d’upgrades
                </label>
                <input
                  id="serie-count"
                  className="field tnum h-8 min-h-0 w-16 text-center"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-describedby="serie-count-max"
                  value={draft ?? String(count)}
                  disabled={running}
                  onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onBlur={commitDraft}
                  onKeyDown={(e) => e.key === "Enter" && commitDraft()}
                />
                <span id="serie-count-max" className="tnum mr-1 text-sm text-muted">
                  sur {fmt(possible.length)}
                </span>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Choix rapide du nombre d’upgrades">
                  {QUICK_COUNTS.filter((n) => n < possible.length).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="chip tnum"
                      aria-pressed={draft === null && count === n}
                      disabled={running}
                      onClick={() => choose(n)}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={draft === null && count === possible.length}
                    disabled={running}
                    onClick={() => choose(null)}
                  >
                    Max
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-text">
                  {manual || singles
                    ? plural(summary.cards, "carte", "cartes")
                    : plural(summary.cards, "doublon", "doublons")}{" "}
                  → {plural(lots.length, "upgrade", "upgrades")}{" "}
                  <span className="font-normal text-muted">
                    ({full} × {lots[0]!} cartes à {chanceText(upgradeChance(rarity, lots[0]!))}
                    {NBSP}%
                    {rest
                      ? ` + 1 × ${plural(rest, "carte", "cartes")} à ${chanceText(upgradeChance(rarity, rest))}${NBSP}%`
                      : ""}
                    )
                  </span>
                </p>
                <p className="tnum mt-1 text-muted">
                  ≈ {decimal(summary.expectedSuccesses)} {RARITY_LABELS[nextRarity(rarity)!].toLowerCase()}
                  {summary.expectedSuccesses >= 2 ? "s" : ""} attendue{summary.expectedSuccesses >= 2 ? "s" : ""} · au
                  pire +{fmt(summary.refundIfAllFail)}
                  {NBSP}PW
                  {pool.length > summary.cards &&
                    ` · ${fmt(pool.length - summary.cards)} ${manual || singles ? "cartes" : "doublons"} au prochain lancement`}
                </p>
                <p className="mt-1 text-xs text-faint">
                  {manual
                    ? "Ta sélection. Jamais de carte engagée ; favoris, brillantes et derniers exemplaires demandent une confirmation."
                    : singles
                      ? "Jamais les favoris, les brillantes ni les cartes engagées."
                      : "Jamais le meilleur exemplaire d’une carte, ni les favoris, les brillantes ou les cartes engagées."}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary max-sm:w-full"
                disabled={disabled || running}
                onClick={launch}
              >
                {running ? "Upgrades en cours…" : `Lancer ${plural(lots.length, "upgrade", "upgrades")}`}
              </button>
            </div>

            {/* Les cartes qui partiront, dans l'ordre des lots : retirer ici, ajouter depuis la liste de la page. */}
            <details className="rounded-lg border border-line" open={manual || undefined}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm font-semibold">
                Cartes utilisées ({fmt(used.length)})
                {warned.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-warn">
                    <TriangleAlert aria-hidden className="size-3.5" />
                    {plural(warned.length, "à confirmer", "à confirmer")}
                  </span>
                )}
              </summary>
              <div className="border-t border-line px-3 pb-3">
                <ul
                  className="max-h-72 divide-y divide-line overflow-y-auto"
                  aria-label="Cartes utilisées par la série"
                >
                  {used.map((c) => (
                    <SeriesCardLine
                      key={c.instanceId}
                      card={c}
                      onRemove={running ? undefined : () => remove(c.instanceId)}
                    />
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-pressed={adding}
                    disabled={running}
                    onClick={() => {
                      if (!manual) onSelection(used);
                      onAdding(!adding);
                    }}
                  >
                    <Plus aria-hidden className="size-4" />
                    {adding ? "Terminer l’ajout" : "Ajouter des cartes"}
                  </button>
                  {manual && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={running}
                      onClick={() => {
                        onSelection(null);
                        onAdding(false);
                      }}
                    >
                      Revenir au choix automatique
                    </button>
                  )}
                </div>
              </div>
            </details>
          </div>
        )}

        {!manual && p && (p.singles > 0 || singles) && (
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
          </div>
        )}
        <AnimatePresence initial={false}>
          {singlesUsed > 0 && (
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
                  {singlesUsed} carte{singlesUsed > 1 ? "s vont" : " va"} quitter ta collection
                </strong>
                {NBSP}: c’est ton dernier exemplaire{singlesUsed > 1 ? " de chacune" : ""}.
              </span>
            </motion.p>
          )}
        </AnimatePresence>

        {shown && (
          <div className="flex flex-col gap-3 border-t-2 border-dashed border-line pt-4" aria-live="polite">
            <p className="tnum text-sm">
              <strong className="text-text">
                {shown.successes} réussite{shown.successes > 1 ? "s" : ""} sur {shown.lots.length}
              </strong>
              <span className="text-muted">{shown.refund ? ` · +${fmt(shown.refund)}${NBSP}PW récupérés` : ""}</span>
            </p>
            {shown.cards.length > 0 && (
              <ol className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
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
            <LotsRecap lots={shown.lots} />
          </div>
        )}

        {runs.length > 0 && (
          <details className="border-t-2 border-dashed border-line pt-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-muted">
              <History aria-hidden className="size-4" />
              Dernières séries ({runs.length})
            </summary>
            <ol className="mt-3 flex flex-col gap-3">
              {runs.map((r) => (
                <li key={r.id}>
                  <details>
                    <summary className="tnum flex cursor-pointer flex-wrap items-center gap-x-2 text-sm">
                      <span className="text-muted">{dateFmt.format(new Date(r.createdAt))}</span>
                      <span>
                        {RARITY_LABELS[r.rarity]} → {RARITY_LABELS[r.target]}
                      </span>
                      <strong className="text-text">
                        {r.successes} réussite{r.successes > 1 ? "s" : ""} sur {r.lots.length}
                      </strong>
                      {r.refund > 0 && (
                        <span className="text-muted">
                          · +{fmt(r.refund)}
                          {NBSP}PW
                        </span>
                      )}
                    </summary>
                    <div className="mt-2">
                      <LotsRecap lots={r.lots} />
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Confirmer la série"
        confirmLabel={`Lancer ${plural(lots.length, "upgrade", "upgrades")}`}
        danger
        onConfirm={() => void run()}
        onClose={() => setConfirming(false)}
      >
        <p>Ces cartes partiront avec la série, même si l’upgrade échoue{NBSP}:</p>
        <ul className="mt-2 max-h-48 divide-y divide-line overflow-y-auto">
          {warned.map((c) => (
            <SeriesCardLine key={c.instanceId} card={c} />
          ))}
        </ul>
      </ConfirmDialog>
    </section>
  );
}
