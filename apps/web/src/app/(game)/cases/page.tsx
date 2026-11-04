"use client";

import {
  CASE_MULTI_OPEN,
  CASE_TIER_LABELS,
  CASE_TIERS,
  RARITY_LABELS,
  type CaseTier,
  type Rarity,
} from "@palacards/game";
import type {
  CaseCardDTO,
  CaseDTO,
  CaseOpenDTO,
  CaseResultDTO,
  CasesDTO,
  CaseTileDTO,
  CaseWinDTO,
} from "@palacards/shared";
import { animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from "motion/react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Avatar } from "@/components/Avatar";
import { Card, RaritySigil } from "@/components/Card";
import { CaseBox } from "@/components/CaseBox";
import { FlipCard } from "@/components/PackOpener";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError, thumbSrc } from "@/lib/api";
import { fmt, relative, timeLeft } from "@/lib/format";
import { useSeenFeature } from "@/lib/features";
import { useHoldNews, useMe } from "@/lib/game";
import { useCardMedia } from "@/lib/media";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";
import "@/components/content.css";
import "@/components/cases.css";

const RARITY_ORDER: Rarity[] = ["L", "UR", "SR", "R", "PC", "C"];

const pct = (chance: number) =>
  `${(chance * 100).toLocaleString("fr-FR", { maximumFractionDigits: chance < 0.01 ? 2 : 1 })} %`;

const lotText = (lot: number) => `${lot} légendaires`;

/** Ce que le joueur a eu, en une ligne (fil des gros tirages, annonce du résultat). */
function outcomeText(o: { rarity: Rarity; lot: number }) {
  return o.lot > 1 ? `un lot de ${lotText(o.lot)}` : `une ${RARITY_LABELS[o.rarity].toLowerCase()}`;
}

type Speed = "normal" | "fast" | "instant";

/** Durée du défilement d'une bande (s) : la plus longue pour une seule caisse, en cascade pour ×5. */
function rollDuration(speed: Speed, reel: number, many: boolean) {
  if (speed === "instant") return 0.5;
  if (speed === "fast") return (many ? 2.4 : 3) + reel * 0.2;
  return (many ? 4.2 : 5.4) + reel * 0.3;
}

/** Bande d'attente : le contenu de la caisse mélangé, tiré selon les vraies chances (comme la vraie bande). */
function previewTiles(box: CaseDTO): CaseTileDTO[] {
  const singles = box.cards.map((c) => ({ w: c.chance, t: { kind: "card", cardId: c.cardId } as CaseTileDTO }));
  const lots = box.outcomes
    .filter((o) => o.lot > 1)
    .map((o) => ({ w: o.chance, t: { kind: "lot", lot: o.lot } as CaseTileDTO }));
  const pool = [...singles, ...lots];
  const total = pool.reduce((s, p) => s + p.w, 0);
  return Array.from({ length: 21 }, () => {
    let r = Math.random() * total;
    for (const p of pool) if ((r -= p.w) < 0) return p.t;
    return pool[0]!.t;
  });
}

/** Une case de la bande : vignette réduite (image, bande de rareté et titre) ou lot de légendaires. */
function Tile({ tile, card, win }: { tile: CaseTileDTO; card?: CaseCardDTO; win: boolean }) {
  const live = useCardMedia(tile.kind === "card" ? tile.cardId : -1);
  const [broken, setBroken] = useState(false);
  if (tile.kind === "lot")
    return (
      <div className="pc-reel-tile" data-lot data-win={win || undefined} data-rarity="L" aria-hidden>
        <span className="pc-reel-tile-lot font-display uppercase">
          ×{tile.lot}
          <small>légendaires</small>
        </span>
      </div>
    );
  if (!card) return <div className="pc-reel-tile" aria-hidden />;
  const url = live?.thumbUrl ?? card.thumbUrl;
  return (
    <div
      className="pc-reel-tile"
      data-rarity={card.rarity}
      data-win={win || undefined}
      style={{ ["--r" as string]: `var(--color-rarity-${card.rarity.toLowerCase()})` }}
      aria-hidden
    >
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- vignette déjà réduite par l'API
        <img src={thumbSrc(url)} alt="" draggable={false} decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="pc-reel-tile-letter font-display uppercase">{card.title.slice(0, 1)}</span>
      )}
      <span className="pc-reel-tile-band font-display uppercase">
        <span>{card.title}</span>
      </span>
    </div>
  );
}

/**
 * Une bande qui défile puis ralentit jusqu'à poser la case gagnante sous la languette, avec un cliquet à
 * chaque case qui passe. Sans `roll`, elle attend immobile (contenu de la caisse).
 */
function Reel({
  tiles,
  cards,
  roll,
  compact = false,
  onStop,
}: {
  tiles: CaseTileDTO[];
  cards: Map<number, CaseCardDTO>;
  /** Tirage à jouer : case gagnante, durée (s), départ et mouvement réduit ; `skip` l'arrête net. */
  roll: { winIndex: number; duration: number; reduce: boolean; skip: boolean } | null;
  compact?: boolean;
  onStop?: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [stopped, setStopped] = useState(false);
  const controls = useRef<AnimationPlaybackControls | null>(null);
  const finish = useRef<(() => void) | null>(null);
  const onStopRef = useRef(onStop);
  useEffect(() => {
    onStopRef.current = onStop;
  });

  const winIndex = roll?.winIndex ?? -1;
  const duration = roll?.duration ?? 0;
  const reduce = !!roll?.reduce;
  const skip = !!roll?.skip;

  // Pas d'une case (largeur + espace), mesuré : il suit la taille de la bande (téléphone, ×5).
  function geometry() {
    const el = track.current;
    const a = el?.children[0] as HTMLElement | undefined;
    const b = el?.children[1] as HTMLElement | undefined;
    const tile = a?.offsetWidth ?? 112;
    return { tile, step: b && a ? b.offsetLeft - a.offsetLeft : tile + 8 };
  }

  // Au repos : une case au centre, sous le repère.
  useLayoutEffect(() => {
    if (roll) return;
    const { tile, step } = geometry();
    x.set(-(Math.floor(tiles.length / 2) * step + tile / 2));
  }, [roll, tiles, x]);

  // Chaque tirage a sa propre bande (montée à neuf) : on la place au départ avant le premier affichage.
  useLayoutEffect(() => {
    if (winIndex < 0) return;
    const { tile, step } = geometry();
    const center = -(winIndex * step + tile / 2);
    // Arrêt quelque part dans la case gagnante, pas pile au milieu : on ne sait qu'à la fin de quel côté.
    const land = reduce ? center : center + (Math.random() - 0.5) * tile * 0.76;
    const from = reduce ? winIndex - 2 : 3;
    x.set(-(from * step + tile / 2));
    let last = Math.floor(-x.get() / step);
    const unsub = x.on("change", (v) => {
      const n = Math.floor(-v / step);
      if (n !== last) {
        last = n;
        play("tick");
      }
    });
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      unsub();
      x.set(center);
      setStopped(true);
      onStopRef.current?.();
    };
    finish.current = () => {
      controls.current?.stop();
      end();
    };
    void (async () => {
      controls.current = animate(x, land, {
        duration,
        ease: reduce ? [0.23, 1, 0.32, 1] : [0.1, 0.72, 0.16, 1],
      });
      await controls.current;
      if (done) return;
      unsub();
      // Petit recentrage : la vignette gagnante se cale sous la languette.
      if (!reduce) {
        controls.current = animate(x, center, { duration: 0.32, ease: [0.77, 0, 0.175, 1] });
        await controls.current;
      }
      end();
    })();
    return () => {
      done = true;
      unsub();
      controls.current?.stop();
    };
  }, [winIndex, duration, reduce, tiles, x]);

  useEffect(() => {
    if (skip) finish.current?.();
  }, [skip]);

  return (
    <div className="pc-reel" data-compact={compact || undefined} data-stopped={(roll && stopped) || undefined}>
      <motion.div ref={track} className="pc-reel-track" style={{ x }}>
        {tiles.map((t, i) => (
          <Tile
            key={i}
            tile={t}
            card={t.kind === "card" ? cards.get(t.cardId) : undefined}
            win={!!roll && stopped && i === winIndex}
          />
        ))}
      </motion.div>
      <span className="pc-reel-marker" aria-hidden />
    </div>
  );
}

/** Résultat d'une ouverture : la vignette retournée, ou le tampon du lot et ses légendaires. */
function Winnings({ results, speed, onShown }: { results: CaseResultDTO[]; speed: Speed; onShown: () => void }) {
  const reduce = useReducedMotion();
  const cards = results.flatMap((r) => r.cards.map((c, i) => ({ card: c, lot: r.lot, first: i === 0 })));
  const lot = results.find((r) => r.lot > 1);
  const value = results.reduce((s, r) => s + r.value, 0);
  const [revealed, setRevealed] = useState(0);
  const flips = cards.filter((c) => c.first).length;
  const many = results.length > 1;
  const shownRef = useRef(onShown);
  useEffect(() => {
    shownRef.current = onShown;
  });

  // Les vignettes se retournent l'une après l'autre ; les autres légendaires d'un lot suivent, déjà face visible.
  useEffect(() => {
    if (revealed >= flips) {
      const t = setTimeout(() => shownRef.current(), speed === "instant" ? 0 : 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => setRevealed((n) => n + 1),
      revealed === 0 ? (speed === "instant" ? 0 : 280) : speed === "normal" ? 260 : 140,
    );
    return () => clearTimeout(t);
  }, [revealed, flips, speed]);

  useEffect(() => {
    if (lot && revealed >= 1) play("coin", 500);
  }, [lot, revealed]);

  let flipIndex = 0;
  return (
    <div className="flex flex-col items-center gap-4" aria-live="polite">
      {lot && (
        <motion.p
          className="pc-case-stamp font-display"
          initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "rotate(-4deg) scale(1.4)" }}
          animate={{ opacity: 1, transform: "rotate(-4deg) scale(1)" }}
          transition={{ duration: 0.38, ease: [0.23, 1, 0.32, 1], delay: 0.15 }}
        >
          ×{lot.lot}
          <small>légendaires d&apos;un coup</small>
        </motion.p>
      )}
      <div
        className={`grid w-full justify-center gap-3 ${
          cards.length === 1
            ? "grid-cols-[minmax(0,11rem)]"
            : cards.length <= 5
              ? "grid-cols-[repeat(auto-fit,minmax(7.5rem,9rem))]"
              : "grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]"
        }`}
      >
        {cards.map(({ card, first }, i) => {
          if (!first) {
            const shown = revealed >= 1;
            return (
              <motion.div
                key={card.instanceId ?? `${card.cardId}-${i}`}
                initial={false}
                animate={
                  shown
                    ? { opacity: 1, transform: "translateY(0px) scale(1)" }
                    : { opacity: 0, transform: "translateY(18px) scale(0.94)" }
                }
                transition={{
                  duration: reduce ? 0 : 0.34,
                  ease: [0.23, 1, 0.32, 1],
                  delay: shown && !reduce ? 0.55 + i * 0.06 : 0,
                }}
              >
                <Card card={card} prefetch={false} />
              </motion.div>
            );
          }
          const n = flipIndex++;
          return (
            <FlipCard
              key={card.instanceId ?? `${card.cardId}-${i}`}
              card={card}
              revealed={revealed > n}
              onReveal={() => setRevealed((r) => Math.max(r, n + 1))}
              index={n}
              speed={speed === "instant" ? "instant" : many ? "fast" : "normal"}
              stagger={false}
            />
          );
        })}
      </div>
      <p className="text-center text-sm text-muted">
        {cards.length > 1 ? `${cards.length} cartes rejoignent` : "La carte rejoint"} ta{" "}
        <Link href="/collection" className="article-link">
          collection
        </Link>
        . Valeur au recyclage&nbsp;: <strong className="tnum text-text">{fmt(value)}&nbsp;PW</strong>.
      </p>
    </div>
  );
}

/** Contenu d'une caisse, groupé par rareté : chaque vignette avec sa chance, puis les lots. */
function Contents({ box }: { box: CaseDTO }) {
  const groups = RARITY_ORDER.map((r) => ({
    rarity: r,
    cards: box.cards.filter((c) => c.rarity === r).sort((a, b) => b.chance - a.chance),
    chance: box.outcomes.filter((o) => o.rarity === r && o.lot === 1).reduce((s, o) => s + o.chance, 0),
  })).filter((g) => g.cards.length);
  const lots = box.outcomes.filter((o) => o.lot > 1);
  return (
    <section className="infobox" aria-labelledby="case-contents">
      <h2 id="case-contents" className="infobox-head">
        Contenu de la caisse {CASE_TIER_LABELS[box.tier]}
      </h2>
      <div className="flex flex-col gap-6 p-4">
        {lots.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <RaritySigil rarity="L" /> Lots de légendaires, toutes différentes
            </h3>
            <ul className="flex flex-wrap gap-2">
              {lots.map((o) => (
                <li
                  key={o.lot}
                  className="tnum flex items-baseline gap-2 rounded-[10px] border border-line-strong px-3 py-1.5 text-sm"
                >
                  <span className="font-display text-lg uppercase leading-none text-[var(--color-rarity-l)]">
                    ×{o.lot}
                  </span>
                  <span className="text-muted">{pct(o.chance)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.rarity}>
            <h3 className="tnum mb-2 flex items-center gap-2 text-sm font-semibold">
              <RaritySigil rarity={g.rarity} withLabel />
              <span className="text-muted">· {pct(g.chance)} au total</span>
            </h3>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))]">
              {g.cards.map((c) => (
                <li key={c.cardId}>
                  <Card card={c} />
                  <p className="pc-case-chance tnum">{pct(c.chance)}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentWins({ wins, now }: { wins: CaseWinDTO[]; now: number }) {
  return (
    <section className="infobox" aria-labelledby="case-recent">
      <h2 id="case-recent" className="infobox-head">
        Gros tirages
      </h2>
      {wins.length ? (
        <ul>
          {wins.map((w) => (
            <li key={w.id} className="flex items-center gap-3 border-t border-line px-4 py-2.5 first:border-0">
              <Avatar name={w.player.displayName} avatar={w.player.avatar} size="sm" />
              <p className="min-w-0 flex-1 text-sm leading-snug">
                <Link href={`/u/${w.player.username}`} className="font-semibold hover:underline">
                  {w.player.displayName}
                </Link>{" "}
                <span className="text-muted">
                  a eu {outcomeText(w)}
                  {w.card && w.lot === 1 ? ` (${w.card.title})` : ""} · {CASE_TIER_LABELS[w.tier]}, {w.collection}
                </span>
              </p>
              <span className="tnum shrink-0 text-right text-xs text-faint">{relative(w.createdAt, now)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">Aucune légendaire sortie d&apos;une caisse pour l&apos;instant.</p>
      )}
    </section>
  );
}

interface Run {
  results: CaseResultDTO[];
  box: CaseDTO;
  reduce: boolean;
  speed: Speed;
  skip: boolean;
  /** Bandes arrêtées. */
  stopped: number;
}

export default function CasesPage() {
  useSeenFeature("cases");
  const { me, mutateMe } = useMe();
  const holdNews = useHoldNews();
  const cases = useSWR<CasesDTO>("/cases");
  const reduceMotion = useReducedMotion();
  const now = useNow(30_000);
  const [pickedCollection, setPickedCollection] = useState<string | null>(null);
  const [pickedTier, setPickedTier] = useState<CaseTier | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [shown, setShown] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const stage = useRef<HTMLElement>(null);

  const data = cases.data;
  const collection = data?.collections.find((c) => c.name === pickedCollection) ?? data?.collections[0];
  const free = data?.free ?? { bronze: 0, silver: 0, gold: 0, legendary: 0 };
  // Niveau affiché : celui choisi, sinon le premier pour lequel le joueur a une caisse gratuite.
  const tier: CaseTier = pickedTier ?? CASE_TIERS.find((t) => free[t] > 0) ?? "bronze";
  const box = collection?.cases.find((c) => c.tier === tier) ?? collection?.cases[0];
  const cardMap = useMemo(() => new Map((box?.cards ?? []).map((c) => [c.cardId, c])), [box]);
  const preview = useMemo(() => (box ? previewTiles(box) : []), [box]);
  const rolling = !!run && run.stopped < run.results.length;
  // La bande est tout l'intérêt d'une caisse : elle ne suit pas la vitesse d'ouverture des paquets (21 joueurs
  // actifs sur 27 sont en « instantané », choix de Palawi). « Passer » l'arrête ; seul le mouvement réduit du
  // système la raccourcit.
  const speed: Speed = "normal";
  const available = me?.wallet.available ?? 0;
  const runBox = run?.box;
  const runCards = useMemo(() => new Map((runBox?.cards ?? []).map((c) => [c.cardId, c])), [runBox]);

  // Changer de caisse efface le dernier tirage.
  function choose(next: { collection?: string; tier?: CaseTier }) {
    if (rolling || busy) return;
    if (next.collection) setPickedCollection(next.collection);
    if (next.tier) setPickedTier(next.tier);
    setRun(null);
    setShown(false);
  }

  async function open(count: number, useFree: boolean) {
    if (!box || busy || rolling) return;
    setBusy(true);
    setShown(false);
    release.current?.();
    // Solde, succès et fil n'annoncent le tirage qu'une fois la bande arrêtée et la carte retournée.
    release.current = holdNews();
    try {
      const res = await api<CaseOpenDTO>(`/cases/${box.id}/open`, { body: { count, free: useFree } });
      setRun({
        results: res.results,
        box,
        reduce: !!reduceMotion,
        speed,
        skip: false,
        stopped: 0,
      });
      requestAnimationFrame(() => {
        const r = stage.current?.getBoundingClientRect();
        if (r && (r.top < 0 || r.bottom > window.innerHeight))
          stage.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
      });
      void cases.mutate((d) => (d ? { ...d, free: res.free } : d), { revalidate: false });
      void mutateMe(
        (m) => (m ? { ...m, wallet: res.wallet, freeCases: Object.values(res.free).reduce((a, b) => a + b, 0) } : m),
        { revalidate: false },
      );
    } catch (err) {
      release.current?.();
      release.current = null;
      toast.error(err instanceof ApiError ? err.message : "La caisse ne s'ouvre pas, réessaie.");
      void cases.mutate();
    } finally {
      setBusy(false);
    }
  }

  function revealDone() {
    release.current?.();
    release.current = null;
    void cases.mutate();
  }

  useEffect(() => () => release.current?.(), []);

  const many = (run?.results.length ?? 0) > 1;
  const allStopped = !!run && run.stopped >= run.results.length;
  const price = box?.price ?? 0;
  const freeHere = free[tier];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Caisses</h1>
        <p className="hatnote mt-2 max-w-[66ch]">
          Une caisse au contenu visible donne une seule carte, tirée selon les chances affichées. Les plus chères
          peuvent lâcher d&apos;un coup un lot de 3, 5 ou 10 légendaires toutes différentes. Deux thèmes chaque semaine,
          renouvelés le lundi soir ; les roues du jour et le passe de saison donnent des caisses gratuites.
        </p>
      </div>

      {cases.error && <ErrorBox error={cases.error} retry={() => cases.mutate()} />}

      {data && !collection && (
        <Empty title="Pas de caisse en ce moment">
          Les caisses de la semaine arrivent le lundi soir. Tes caisses gratuites t&apos;attendent jusque-là.
        </Empty>
      )}

      {collection && box && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Thème des caisses">
              {data!.collections.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className="chip"
                  aria-pressed={c.name === collection.name}
                  onClick={() => choose({ collection: c.name })}
                  disabled={rolling || busy}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <p className="tnum text-sm text-muted">
              En vente encore {timeLeft(new Date(collection.endsAt).getTime() - now)}
            </p>
          </div>

          <ol className="pc-case-tiers" aria-label="Niveaux de caisse">
            {CASE_TIERS.map((t) => {
              const c = collection.cases.find((x) => x.tier === t);
              if (!c) return null;
              return (
                <li key={t}>
                  <button
                    type="button"
                    className="pc-case-tier"
                    data-case={t}
                    aria-pressed={t === box.tier}
                    onClick={() => choose({ tier: t })}
                    disabled={rolling || busy}
                  >
                    <CaseBox tier={t} />
                    <span className="min-w-0">
                      <span className="block font-display text-[1.2rem] uppercase leading-none">
                        {CASE_TIER_LABELS[t]}
                      </span>
                      <span className="tnum mt-1 block text-xs font-semibold">{fmt(c.price)} PW</span>
                    </span>
                    {free[t] > 0 && (
                      <span
                        className="pc-case-free tnum"
                        title={`${free[t]} caisse${free[t] > 1 ? "s" : ""} gratuite${free[t] > 1 ? "s" : ""}`}
                      >
                        {free[t]}
                        <span className="sr-only"> gratuite{free[t] > 1 ? "s" : ""}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>

          <section ref={stage} className="flex scroll-mt-4 flex-col gap-4" aria-label="Ouverture">
            {run ? (
              <div className="flex flex-col gap-2">
                {run.results.map((r, i) => (
                  <Reel
                    key={`${i}-${r.winIndex}-${r.cards[0]?.instanceId ?? i}`}
                    tiles={r.tiles}
                    cards={runCards}
                    compact={many}
                    roll={{
                      winIndex: r.winIndex,
                      duration: rollDuration(run.reduce ? "instant" : run.speed, i, many),
                      reduce: run.reduce,
                      skip: run.skip,
                    }}
                    onStop={() => setRun((cur) => (cur ? { ...cur, stopped: cur.stopped + 1 } : cur))}
                  />
                ))}
              </div>
            ) : (
              <Reel tiles={preview} cards={cardMap} roll={null} />
            )}

            <div className="flex flex-wrap items-center justify-center gap-2">
              {rolling ? (
                <button
                  type="button"
                  className="btn min-h-12 min-w-40"
                  onClick={() => setRun((cur) => (cur ? { ...cur, skip: true } : cur))}
                >
                  Passer
                </button>
              ) : (
                <>
                  {freeHere > 0 && (
                    <button
                      type="button"
                      className="btn btn-primary min-h-12 text-base"
                      onClick={() => open(1, true)}
                      disabled={busy || !me}
                    >
                      Ouvrir une caisse gratuite <span className="tnum font-normal opacity-80">({freeHere})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn min-h-12 text-base ${freeHere > 0 ? "" : "btn-primary"}`}
                    onClick={() => open(1, false)}
                    disabled={busy || !me || available < price}
                  >
                    Ouvrir <span className="tnum font-normal opacity-80">{fmt(price)} PW</span>
                  </button>
                  <button
                    type="button"
                    className="btn min-h-12 text-base"
                    onClick={() => open(CASE_MULTI_OPEN, false)}
                    disabled={busy || !me || available < price * CASE_MULTI_OPEN}
                  >
                    Ouvrir ×{CASE_MULTI_OPEN}{" "}
                    <span className="tnum font-normal opacity-80">{fmt(price * CASE_MULTI_OPEN)} PW</span>
                  </button>
                </>
              )}
            </div>
            {!rolling && me && available < price && freeHere === 0 && (
              <p className="tnum text-center text-sm text-muted">
                Il te manque {fmt(price - available)} PW pour cette caisse.
              </p>
            )}

            {run && allStopped && (
              <Winnings
                key={run.results.map((r) => r.cards[0]?.instanceId).join("-")}
                results={run.results}
                speed={run.reduce ? "instant" : run.speed}
                onShown={() => {
                  if (!shown) {
                    setShown(true);
                    revealDone();
                  }
                }}
              />
            )}
          </section>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Contents box={box} />
            <div className="flex flex-col gap-4">
              <section className="infobox" aria-labelledby="case-odds">
                <h2 id="case-odds" className="infobox-head">
                  Chances
                </h2>
                <table className="tnum w-full text-sm">
                  <tbody>
                    {box.outcomes.map((o) => (
                      <tr key={`${o.rarity}-${o.lot}`} className="border-t border-line first:border-0">
                        <td className="px-4 py-1.5">
                          <span className="inline-flex items-center gap-2">
                            <RaritySigil rarity={o.rarity} />
                            {o.lot > 1 ? `Lot de ${lotText(o.lot)}` : RARITY_LABELS[o.rarity]}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right text-muted">{pct(o.chance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="tnum border-t-2 border-dashed border-line px-4 py-2.5 text-xs text-muted">
                  En moyenne, une caisse {CASE_TIER_LABELS[box.tier]} rend {fmt(Math.round(box.expectedValue))} PW au
                  recyclage, pour {fmt(box.price)} PW. Une caisse gratuite s&apos;ouvre dans n&apos;importe quel thème
                  de son niveau.
                </p>
              </section>
              <RecentWins wins={data?.recent ?? []} now={now} />
            </div>
          </div>
        </>
      )}

      {!data && !cases.error && (
        <div className="flex flex-col gap-4" aria-hidden>
          <div className="pc-case-tiers">
            {CASE_TIERS.map((t) => (
              <div key={t} className="h-[4.5rem] animate-pulse rounded-xl bg-panel" />
            ))}
          </div>
          <div className="h-44 animate-pulse rounded-[14px] bg-panel" />
        </div>
      )}
    </div>
  );
}
