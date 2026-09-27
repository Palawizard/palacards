"use client";

import {
  nextRarity,
  RARITIES,
  RARITY_LABELS,
  UPGRADE_MAX_CARDS,
  UPGRADE_MIN_CARDS,
  upgradeChance,
  upgradeRefund,
  type Rarity,
} from "@palacards/game";
import type { CardDTO, Page, UpgradeResultDTO } from "@palacards/shared";
import { ArrowRight, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid } from "@/components/Card";
import { CardBack, FlipCard } from "@/components/PackOpener";
import { CardSkeletons, Empty, ErrorBox, LoadMore, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { useCardMedia } from "@/lib/media";
import { play } from "@/lib/sfx";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Raretés qu'on peut sacrifier (une légendaire n'a rien au-dessus). */
const SOURCES = RARITIES.filter((r) => nextRarity(r) !== null);
const pct = (bp: number) => `${Math.round(bp / 100)} %`;

type Phase = "idle" | "fusing" | "done";

/** Dos de la carte visée, teinté de sa rareté : ce qu'on tente d'obtenir. */
function TargetBack({ rarity, failed }: { rarity: Rarity; failed: boolean }) {
  return (
    <div
      className={`relative aspect-[5/7] w-full transition-[filter,opacity] duration-300 ${failed ? "opacity-45 grayscale" : ""}`}
      style={{ ["--r" as string]: `var(--color-rarity-${rarity.toLowerCase()})` }}
    >
      <CardBack />
      <span className="absolute inset-0 rounded-[12px] shadow-[inset_0_0_0_3px_var(--r)]" aria-hidden />
      <span className="pc-sigil absolute bottom-[8%] left-1/2 -translate-x-1/2 text-base">{rarity}</span>
    </div>
  );
}

/** Case remplie sur téléphone : la vignette entière serait illisible à cette taille. */
function SlotTile({ card }: { card: CardDTO }) {
  const media = useCardMedia(card.cardId);
  const thumb = media?.thumbUrl ?? card.thumbUrl;
  return (
    <div
      className="relative flex aspect-[5/7] flex-col overflow-hidden rounded-[10px] bg-sticker text-sticker-ink shadow-[var(--shadow-lift)] sm:hidden"
      style={{ ["--r" as string]: `var(--color-rarity-${card.rarity.toLowerCase()})` }}
      title={card.title}
    >
      <div className="relative flex-1 bg-[color-mix(in_oklab,var(--r)_18%,var(--color-sticker))]">
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element -- vignettes Wikimedia servies telles quelles
          <img src={thumb} alt="" className="absolute inset-0 size-full object-cover" />
        )}
      </div>
      <p
        className={`line-clamp-2 bg-[var(--r)] px-1 py-0.5 text-[9px] font-bold leading-tight ${card.rarity === "C" || card.rarity === "PC" || card.rarity === "L" ? "text-[#111]" : "text-white"}`}
      >
        {card.title}
      </p>
    </div>
  );
}

export default function UpgradePage() {
  const { me } = useMe();
  const reduce = useReducedMotion();
  const [rarity, setRarity] = useState<Rarity>("C");
  const [duplicates, setDuplicates] = useState(true);
  const [picked, setPicked] = useState<CardDTO[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<UpgradeResultDTO | null>(null);
  const [revealed, setRevealed] = useState(false);

  const target = nextRarity(rarity)!;
  const count = picked.length;
  const chance = count >= UPGRADE_MIN_CARDS ? upgradeChance(rarity, count) : null;

  const params = `rarity=${rarity}${duplicates ? "&duplicates=true" : ""}&sort=date&limit=60`;
  const list = useSWRInfinite<Page<CardDTO>>((i, prev) =>
    prev && !prev.nextCursor ? null : `/collection?${params}&page=${i}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((s) => s + 1);
  }, [list]);

  function chooseRarity(r: Rarity) {
    if (phase === "fusing") return;
    setRarity(r);
    setPicked([]);
    setPhase("idle");
    setResult(null);
  }

  function toggle(card: CardDTO) {
    if (phase !== "idle") return reset(card);
    setPicked((p) =>
      p.some((c) => c.instanceId === card.instanceId)
        ? p.filter((c) => c.instanceId !== card.instanceId)
        : p.length >= UPGRADE_MAX_CARDS
          ? p
          : [...p, card],
    );
  }

  /** Après un essai : on repart d'un établi vide (avec la carte cliquée, le cas échéant). */
  function reset(card?: CardDTO) {
    setPhase("idle");
    setResult(null);
    setRevealed(false);
    setPicked(card ? [card] : []);
  }

  async function attempt() {
    if (count < UPGRADE_MIN_CARDS || phase !== "idle") return;
    setPhase("fusing");
    play("tear");
    try {
      const [res] = await Promise.all([
        api<UpgradeResultDTO>("/upgrade", { body: { instanceIds: picked.map((c) => c.instanceId) } }),
        new Promise((r) => setTimeout(r, reduce ? 0 : 750)),
      ]);
      setResult(res);
      setPhase("done");
      setPicked([]);
      if (res.success) setTimeout(() => setRevealed(true), reduce ? 0 : 380);
      else play("wrong");
      void list.mutate();
    } catch (err) {
      setPhase("idle");
      toast.error(err instanceof ApiError ? err.message : "Upgrade impossible.");
      void list.mutate();
    }
  }

  const slots = Array.from({ length: UPGRADE_MAX_CARDS }, (_, i) => picked[i] ?? null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Upgrader</h1>
        <p className="hatnote mt-2">
          Sacrifie {UPGRADE_MIN_CARDS} à {UPGRADE_MAX_CARDS} cartes d’une même rareté pour tenter une carte de la rareté
          au-dessus. Plus tu en mets, plus tes chances montent. Raté : les cartes sont perdues, tu récupères la moitié
          de leur valeur de recyclage.
        </p>
      </div>

      {/* L'établi : cartes posées, flèche, carte visée et chances. */}
      <section className="infobox" aria-label="Établi de l'upgrader">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-dashed border-line px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-sm font-semibold text-muted">Sacrifier des</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Rareté à sacrifier" data-active>
              {SOURCES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="rarity-toggle"
                  data-rarity={r}
                  aria-pressed={r === rarity}
                  aria-label={RARITY_LABELS[r]}
                  title={RARITY_LABELS[r]}
                  disabled={phase === "fusing"}
                  onClick={() => chooseRarity(r)}
                  style={{ ["--r" as string]: `var(--color-rarity-${r.toLowerCase()})` }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-muted">
            {RARITY_LABELS[rarity]} <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" />{" "}
            <strong className="text-text">{RARITY_LABELS[target]}</strong>
            {target === "L" && <span className="text-faint"> · chances divisées par deux</span>}
          </p>
        </div>

        <div className="grid items-center gap-5 p-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,11rem)]">
          <ol className="grid grid-cols-5 gap-2 sm:gap-3" aria-label="Cartes à sacrifier">
            {slots.map((card, i) => (
              <li key={card?.instanceId ?? `slot-${i}`} className="relative">
                <AnimatePresence mode="popLayout" initial={false}>
                  {card ? (
                    <motion.div
                      key={card.instanceId}
                      initial={{ opacity: 0, transform: "translateY(10px) scale(0.94)" }}
                      animate={
                        phase === "fusing" && !reduce
                          ? {
                              opacity: 0,
                              transform: `translateX(${(2 - i) * 40}%) translateY(-6%) scale(0.82)`,
                              filter: "blur(3px)",
                            }
                          : { opacity: 1, transform: "translateX(0%) translateY(0px) scale(1)", filter: "blur(0px)" }
                      }
                      exit={{ opacity: 0, transform: "scale(0.94)" }}
                      transition={{
                        duration: phase === "fusing" ? 0.6 : 0.22,
                        ease: EASE_OUT,
                        delay: phase === "fusing" ? i * 0.04 : 0,
                      }}
                      className="relative"
                    >
                      <div className="hidden sm:block">
                        <Card card={card} href={null} />
                      </div>
                      <SlotTile card={card} />
                      {phase === "idle" && (
                        <button
                          type="button"
                          onClick={() => toggle(card)}
                          className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border border-line-strong bg-panel text-muted shadow-sm transition-transform duration-150 hover:text-text active:scale-95"
                          aria-label={`Retirer ${card.title}`}
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key={`empty-${i}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`slot grid aspect-[5/7] place-items-center font-display text-3xl ${
                        i < UPGRADE_MIN_CARDS ? "text-line-strong" : "border-line text-line"
                      }`}
                      aria-label={i < UPGRADE_MIN_CARDS ? `Case ${i + 1}, obligatoire` : `Case ${i + 1}, facultative`}
                    >
                      {i + 1}
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ol>

          <ArrowRight aria-hidden className="mx-auto hidden size-7 text-faint md:block" />

          <div className="mx-auto flex w-40 flex-col items-center gap-3 md:w-full">
            <div className="w-32">
              {phase === "done" && result?.success && result.card ? (
                <FlipCard
                  card={result.card}
                  revealed={revealed}
                  onReveal={() => setRevealed(true)}
                  index={0}
                  speed={me?.animationSpeed ?? "normal"}
                  stagger={false}
                />
              ) : (
                <motion.div
                  animate={
                    phase === "fusing" && !reduce
                      ? { transform: ["scale(1)", "scale(1.04)", "scale(1)"] }
                      : phase === "done" && !reduce
                        ? { transform: ["translateX(0px)", "translateX(-6px)", "translateX(5px)", "translateX(0px)"] }
                        : { transform: "scale(1)" }
                  }
                  transition={{ duration: phase === "fusing" ? 0.75 : 0.32, ease: "easeInOut" }}
                >
                  <TargetBack rarity={target} failed={phase === "done" && !result?.success} />
                </motion.div>
              )}
            </div>
            <div className="text-center" aria-live="polite">
              {phase === "done" && result ? (
                result.success ? (
                  <p className="text-sm">
                    <strong className="font-display text-xl uppercase text-good">Réussi !</strong>
                    <span className="block text-muted">
                      {revealed && result.card ? result.card.title : "Retourne la carte."}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm">
                    <strong className="font-display text-xl uppercase text-danger">Raté</strong>
                    <span className="tnum block text-muted">+{fmt(result.refund)} PW récupérés</span>
                  </p>
                )
              ) : (
                <>
                  <p className="font-display text-4xl leading-none">{chance !== null ? pct(chance) : "—"}</p>
                  <p className="tnum mt-1 text-xs text-faint">
                    {chance !== null
                      ? `Raté : +${fmt(upgradeRefund(rarity, count))} PW`
                      : `Encore ${UPGRADE_MIN_CARDS - count} carte${UPGRADE_MIN_CARDS - count > 1 ? "s" : ""}`}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t-2 border-dashed border-line px-4 py-3">
          {phase === "done" ? (
            <>
              {result?.success && revealed && (
                <Link href="/collection" className="btn btn-ghost">
                  Voir ma collection
                </Link>
              )}
              <button type="button" className="btn btn-primary min-w-44" onClick={() => reset()}>
                Nouvel essai
              </button>
            </>
          ) : (
            <>
              {count > 0 && phase === "idle" && (
                <button type="button" className="btn btn-ghost" onClick={() => setPicked([])}>
                  Vider
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary min-w-44"
                disabled={count < UPGRADE_MIN_CARDS || phase !== "idle"}
                onClick={attempt}
              >
                {phase === "fusing"
                  ? "Upgrade en cours…"
                  : chance !== null
                    ? `Tenter l’upgrade · ${pct(chance)}`
                    : `Choisis ${UPGRADE_MIN_CARDS} cartes ou plus`}
              </button>
            </>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title m-0">Tes cartes {RARITY_LABELS[rarity].toLowerCase()}s</h2>
          <Toggle pressed={duplicates} onChange={setDuplicates}>
            Doublons seulement
          </Toggle>
        </div>
        {list.error ? (
          <ErrorBox error={list.error} retry={() => list.mutate()} />
        ) : !list.data ? (
          <CardSkeletons count={6} />
        ) : items.length === 0 ? (
          <Empty title={duplicates ? "Aucun doublon de cette rareté" : "Aucune carte de cette rareté"}>
            {duplicates ? (
              <button type="button" className="article-link" onClick={() => setDuplicates(false)}>
                Voir toutes les cartes de cette rareté
              </button>
            ) : (
              <Link href="/pulls" className="article-link">
                Ouvrir des paquets
              </Link>
            )}
          </Empty>
        ) : (
          <>
            <CardGrid dense>
              {items.map((card) => {
                const on = picked.some((c) => c.instanceId === card.instanceId);
                const full = !on && picked.length >= UPGRADE_MAX_CARDS;
                return (
                  <button
                    key={card.instanceId}
                    type="button"
                    aria-pressed={on}
                    disabled={!!card.locked || phase === "fusing" || (full && phase === "idle")}
                    title={card.locked ? "Engagée dans une vente ou un échange" : undefined}
                    className="text-left transition-[transform,opacity] duration-150 active:scale-[0.98] disabled:opacity-40"
                    onClick={() => toggle(card)}
                  >
                    <Card card={card} href={null} selected={on} />
                  </button>
                );
              })}
            </CardGrid>
            <LoadMore onVisible={loadMore} loading={list.isValidating} done={done} />
          </>
        )}
      </section>
    </div>
  );
}
