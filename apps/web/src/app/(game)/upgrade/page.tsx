"use client";

import {
  nextRarity,
  RARITIES,
  RARITY_LABELS,
  UPGRADE_MAX_CARDS,
  UPGRADE_MAX_CHANCE,
  UPGRADE_MIN_CARDS,
  upgradeChance,
  upgradeCardsToCap,
  upgradeChancePerCard,
  upgradeRefund,
  type Rarity,
} from "@palacards/game";
import type { CardDTO, Page, UpgradeResultDTO } from "@palacards/shared";
import { ArrowRight, Info, X } from "lucide-react";
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid } from "@/components/Card";
import { CardImage } from "@/components/CardImage";
import { CardBack, FlipCard } from "@/components/PackOpener";
import { CardSkeletons, Empty, ErrorBox, LoadMore, Toggle } from "@/components/ui";
import { chanceText, UpgradeDial, type DialState } from "@/components/UpgradeDial";
import { api, ApiError, thumbSrc } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useCardMedia } from "@/lib/media";
import { play } from "@/lib/sfx";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Raretés qu'on peut sacrifier (une légendaire n'a rien au-dessus). */
const SOURCES = RARITIES.filter((r) => nextRarity(r) !== null);
/**
 * Tour d'aiguille, comme sur un vrai upgrader : toujours joué, quel que soit le réglage de vitesse des
 * paquets (il ne concerne que l'ouverture des paquets). Départ vif puis longue décélération jusqu'au tirage.
 */
const SPIN = { turns: 5, duration: 4.6, ease: [0.1, 0.7, 0.12, 1] } as const;
/** Un cliquetis tous les 30° parcourus par l'aiguille. */
const TICK_EVERY = 30;
/** Espace insécable (avant « : » et « % », entre un nombre et son unité). */
const NBSP = String.fromCharCode(160);

type Phase = "idle" | "fusing" | "spinning" | "done";

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

/** Case remplie quand l'établi est étroit : la vignette entière serait illisible à cette taille. */
function SlotTile({ card }: { card: CardDTO }) {
  const media = useCardMedia(card.cardId);
  const thumbUrl = media?.thumbUrl ?? card.thumbUrl;
  const thumb = thumbUrl && thumbSrc(thumbUrl);
  return (
    <div
      className="relative flex aspect-[5/7] flex-col overflow-hidden rounded-[10px] bg-sticker text-sticker-ink shadow-[var(--shadow-lift)] @min-[44rem]:hidden"
      style={{ ["--r" as string]: `var(--color-rarity-${card.rarity.toLowerCase()})` }}
      title={card.title}
    >
      <div className="relative flex-1 bg-[color-mix(in_oklab,var(--r)_18%,var(--color-sticker))]">
        {thumb ? (
          <CardImage cardId={card.cardId} src={thumb} revealable={false} loading="eager" />
        ) : (
          <span className="grid size-full place-items-center font-display text-2xl uppercase text-sticker-muted">
            {card.title.slice(0, 1)}
          </span>
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
  const reduce = useReducedMotion();
  const [rarity, setRarity] = useState<Rarity>("C");
  const [duplicates, setDuplicates] = useState(true);
  const [picked, setPicked] = useState<CardDTO[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<UpgradeResultDTO | null>(null);
  const [revealed, setRevealed] = useState(false);
  const rotation = useMotionValue(0);
  const lastTick = useRef(0);
  const dialRef = useRef<HTMLDivElement>(null);

  const target = nextRarity(rarity)!;
  const count = picked.length;
  // Pendant et après le tour, le cadran garde la chance jouée (les cartes ont quitté l'établi).
  const chance = result?.chance ?? (count >= UPGRADE_MIN_CARDS ? upgradeChance(rarity, count) : null);
  const perCard = upgradeChancePerCard(rarity);
  const capped = chance !== null && chance >= UPGRADE_MAX_CHANCE;
  /** Au-delà, une carte de plus ne change plus rien : la chance est déjà au plafond. */
  const useful = upgradeCardsToCap(rarity) ?? UPGRADE_MAX_CARDS;
  const dial: DialState =
    phase === "spinning" ? "spinning" : phase === "done" && result ? (result.success ? "win" : "lose") : "idle";

  const params = `rarity=${rarity}${duplicates ? "&duplicates=true" : ""}&sort=date&limit=60`;
  const list = useSWRInfinite<Page<CardDTO>>((i, prev) =>
    prev && !prev.nextCursor ? null : `/collection?${params}&page=${i}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((s) => s + 1);
  }, [list]);

  // Retour d'une fiche ouverte par-dessus (favori, recyclage, fusion, vente…) : la liste se recharge et l'établi
  // lâche les cartes devenues favorites, engagées ou disparues.
  const pathname = usePathname();
  const away = useRef(false);
  const { mutate: reloadList } = list;
  useEffect(() => {
    if (pathname !== "/upgrade") {
      away.current = true;
      return;
    }
    if (!away.current) return;
    away.current = false;
    void reloadList().then((pages) => {
      if (!pages) return;
      const fresh = new Map(pages.flatMap((p) => p.items).map((c) => [c.instanceId, c]));
      setPicked((p) => {
        const kept = p.filter((c) => {
          const now = fresh.get(c.instanceId);
          return now && !now.favorite && !now.locked;
        });
        return kept.length === p.length ? p : kept;
      });
    });
  }, [pathname, reloadList]);

  // Cliquetis de l'aiguille, comme la roue du jour.
  useEffect(
    () =>
      rotation.on("change", (r) => {
        if (phase !== "spinning") return;
        const n = Math.floor(r / TICK_EVERY);
        if (n !== lastTick.current) {
          lastTick.current = n;
          play("deal");
        }
      }),
    [rotation, phase],
  );

  /** L'aiguille revient en haut, au départ de l'arc. */
  function homeNeedle() {
    const r = rotation.get();
    const mod = ((r % 360) + 360) % 360;
    const home = mod > 180 ? r + 360 - mod : r - mod;
    void animate(rotation, home, { duration: reduce ? 0.2 : 0.4, ease: EASE_OUT });
  }

  function chooseRarity(r: Rarity) {
    if (phase === "fusing" || phase === "spinning") return;
    setRarity(r);
    reset();
  }

  function toggle(card: CardDTO) {
    if (phase === "done") return reset(card);
    if (phase !== "idle") return;
    setPicked((p) =>
      p.some((c) => c.instanceId === card.instanceId)
        ? p.filter((c) => c.instanceId !== card.instanceId)
        : p.length >= useful
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
    homeNeedle();
  }

  /** Les cartes suivantes de la liste (jusqu'à remplir l'établi), pour ne pas cliquer dix fois. Jamais les favoris. */
  function fill() {
    if (phase !== "idle") return;
    setPicked((p) => {
      const free = items.filter(
        (c) => !c.locked && !c.favorite && !c.shiny && !p.some((x) => x.instanceId === c.instanceId),
      );
      return [...p, ...free.slice(0, Math.max(0, useful - p.length))];
    });
  }

  async function attempt() {
    if (count < UPGRADE_MIN_CARDS || phase !== "idle") return;
    setPhase("fusing");
    play("tear");
    // Sur téléphone, le bouton est sous les cases : on remonte au cadran pour voir l'aiguille tourner.
    // (après le rendu : un défilement lancé pendant le clic est interrompu par la mise à jour de l'établi).
    requestAnimationFrame(() => {
      const box = dialRef.current?.getBoundingClientRect();
      if (box && (box.top < 64 || box.bottom > window.innerHeight))
        dialRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    });
    try {
      const [res] = await Promise.all([
        api<UpgradeResultDTO>("/upgrade", { body: { instanceIds: picked.map((c) => c.instanceId) } }),
        new Promise((r) => setTimeout(r, reduce ? 150 : 450)),
      ]);
      setResult(res);
      setPicked([]);
      setPhase("spinning");
      // L'aiguille fait plusieurs tours puis s'arrête sur le tirage : dans l'arc si c'est gagné.
      // Mouvement réduit : pas de tours, un court glissement jusqu'au tirage.
      const current = rotation.get();
      lastTick.current = Math.floor(current / TICK_EVERY);
      const angle = ((res.roll + Math.random()) / 10_000) * 360;
      const base = current - (((current % 360) + 360) % 360);
      const end = base + (reduce ? 0 : 360 * SPIN.turns) + angle;
      await animate(
        rotation,
        end,
        reduce ? { duration: 0.6, ease: EASE_OUT } : { duration: SPIN.duration, ease: SPIN.ease },
      );
      setPhase("done");
      if (res.success) setTimeout(() => setRevealed(true), reduce ? 0 : 380);
      else play("wrong");
      void list.mutate();
    } catch (err) {
      setPhase("idle");
      setResult(null);
      toast.error(err instanceof ApiError ? err.message : "Upgrade impossible.");
      void list.mutate();
    }
  }

  const slots = Array.from({ length: UPGRADE_MAX_CARDS }, (_, i) => picked[i] ?? null);
  const busy = phase === "fusing" || phase === "spinning";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Upgrader</h1>
        <p className="hatnote mt-2">
          Sacrifie de {UPGRADE_MIN_CARDS} à {UPGRADE_MAX_CARDS} cartes d’une même rareté pour tenter une carte de la
          rareté au-dessus. Chaque carte ajoute sa part de chance, jusqu’à {chanceText(UPGRADE_MAX_CHANCE)}&nbsp;% au
          plus. Si l’aiguille s’arrête hors de l’arc, les cartes sont perdues et tu récupères un quart de leur valeur de
          recyclage.
        </p>
      </div>

      {/* L'établi : cadran, carte visée et cartes posées. */}
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
                  disabled={busy}
                  onClick={() => chooseRarity(r)}
                  style={{ ["--r" as string]: `var(--color-rarity-${r.toLowerCase()})` }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
            <span>
              {RARITY_LABELS[rarity]} <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" />{" "}
              <strong className="text-text">{RARITY_LABELS[target]}</strong>
            </span>
            <span className="tnum whitespace-nowrap text-faint">
              +{chanceText(perCard)} % par carte
              {useful < UPGRADE_MAX_CARDS && ` · ${useful} cartes pour le maximum`}
            </span>
          </p>
        </div>

        <div className="grid items-center gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] lg:gap-8">
          {/* Cadran et carte visée. */}
          <div className="flex items-center justify-center gap-4 sm:gap-6 lg:order-2 lg:flex-col lg:gap-4">
            <div ref={dialRef} className="w-[min(15rem,58vw)] lg:w-full lg:max-w-[17rem]">
              <UpgradeDial chance={chance} target={target} rotation={rotation} state={dial} />
            </div>
            <div className="flex w-24 shrink-0 flex-col items-center gap-2 sm:w-28 lg:w-auto lg:flex-row lg:gap-4">
              <div className="w-24 sm:w-28 lg:w-24">
                {phase === "done" && result?.success && result.card ? (
                  <FlipCard
                    card={result.card}
                    revealed={revealed}
                    onReveal={() => setRevealed(true)}
                    index={0}
                    speed="normal"
                    stagger={false}
                  />
                ) : (
                  <motion.div
                    animate={
                      phase === "done" && !reduce
                        ? { transform: ["translateX(0px)", "translateX(-6px)", "translateX(5px)", "translateX(0px)"] }
                        : { transform: "translateX(0px)" }
                    }
                    transition={{ duration: 0.32, ease: "easeInOut" }}
                  >
                    <TargetBack rarity={target} failed={phase === "done" && !result?.success} />
                  </motion.div>
                )}
              </div>
              <p className="tnum text-center text-xs text-muted lg:max-w-32 lg:text-left" aria-live="polite">
                {phase === "done" && result && (
                  <span className="sr-only">{result.success ? `Réussi${NBSP}: ` : `Raté${NBSP}: `}</span>
                )}
                {phase === "done" && result
                  ? result.success
                    ? revealed && result.card
                      ? result.card.title
                      : "Retourne la carte."
                    : result.refund
                      ? `+${fmt(result.refund)}${NBSP}PW récupérés`
                      : "Cartes perdues."
                  : phase === "spinning"
                    ? "L’aiguille tourne…"
                    : chance !== null
                      ? capped
                        ? `Chance au maximum${NBSP}: inutile d’ajouter des cartes.`
                        : upgradeRefund(rarity, count)
                          ? `Raté${NBSP}: +${fmt(upgradeRefund(rarity, count))}${NBSP}PW`
                          : `Raté${NBSP}: cartes perdues.`
                      : "Pose des cartes dans les cases."}
              </p>
            </div>
          </div>

          {/* Cartes posées : deux rangées de cinq cases. */}
          <div className="@container lg:order-1">
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
                            ? { opacity: 0, transform: "translateY(-8%) scale(0.86)", filter: "blur(3px)" }
                            : { opacity: 1, transform: "translateY(0px) scale(1)", filter: "blur(0px)" }
                        }
                        exit={{ opacity: 0, transform: "scale(0.94)" }}
                        transition={{
                          duration: phase === "fusing" ? 0.4 : 0.22,
                          ease: EASE_OUT,
                          delay: phase === "fusing" ? i * 0.03 : 0,
                        }}
                        className="relative"
                      >
                        <div className="hidden @min-[44rem]:block">
                          <Card card={card} href={null} />
                        </div>
                        <SlotTile card={card} />
                        {phase === "idle" && (
                          <button
                            type="button"
                            onClick={() => toggle(card)}
                            className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full border border-line-strong bg-panel text-muted shadow-sm transition-transform duration-150 after:absolute after:-inset-2.5 after:content-[''] hover:text-text active:scale-95"
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
                        className={`slot grid aspect-[5/7] place-items-center font-display text-2xl text-line-strong transition-opacity duration-200 ${
                          i >= useful ? "opacity-35" : ""
                        }`}
                        aria-label={
                          i >= useful ? `Case ${i + 1}, inutile : chance déjà au maximum` : `Case ${i + 1}, vide`
                        }
                        title={i >= useful ? "Chance déjà au maximum" : undefined}
                      >
                        {i + 1}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              ))}
            </ol>
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
              {phase === "idle" && count < useful && items.some((c) => !c.locked) && (
                <button type="button" className="btn" onClick={fill}>
                  Remplir
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary min-w-44 max-sm:w-full"
                disabled={count < UPGRADE_MIN_CARDS || phase !== "idle"}
                onClick={attempt}
              >
                {busy
                  ? "Upgrade en cours…"
                  : chance !== null
                    ? `Tenter l’upgrade · ${chanceText(chance)}${NBSP}%`
                    : "Choisis des cartes"}
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
                const full = !on && picked.length >= useful;
                return (
                  <div key={card.instanceId} className="group/card relative">
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={!!card.locked || busy || (full && phase === "idle")}
                      title={card.locked ? "Engagée dans une vente ou un échange" : undefined}
                      className="w-full text-left transition-[transform,opacity] duration-150 active:scale-[0.98] disabled:opacity-40"
                      onClick={() => toggle(card)}
                    >
                      <Card card={card} href={null} selected={on} />
                    </button>
                    {/* Fiche par-dessus l'upgrader (favori, tags…) ; au survol à la souris, toujours au doigt. */}
                    <Link
                      href={`/card/${card.cardId}`}
                      scroll={false}
                      prefetch={false}
                      aria-label={`Fiche de ${card.title}`}
                      title="Voir la fiche"
                      className="absolute -right-1.5 -top-1.5 z-[3] grid size-7 place-items-center rounded-full border border-line-strong bg-panel text-muted shadow-sm transition-[opacity,transform,color] duration-150 ease-out after:absolute after:-inset-2 after:content-[''] hover:text-text active:scale-95 pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:focus-visible:opacity-100"
                    >
                      <Info className="size-4" aria-hidden />
                    </Link>
                  </div>
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
