// Vitrine de son propre profil : ajout, retrait et ordre des cartes (importé uniquement par des composants client).
import type { CardDTO, Page } from "@palacards/shared";
import { ChevronLeft, ChevronRight, GripVertical, Plus, Search, X } from "lucide-react";
import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid } from "@/components/Card";
import { CardSkeletons, Empty, ErrorBox, LoadMore } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useDebounced } from "@/lib/use-debounced";

/** Places de la vitrine (SHOWCASE_SIZE côté API). */
const SIZE = 5;

/** Grille de la vitrine : les 5 places tiennent sur une ligne en grand écran. */
const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5";

/** Glissement en cours : carte saisie, position du pointeur et emplacements mesurés au départ. */
interface Drag {
  id: number;
  pointerId: number;
  /** Point de saisie dans la carte. */
  grabX: number;
  grabY: number;
  /** Pointeur (coordonnées de la page). */
  x: number;
  y: number;
  /** Emplacement i de la grille (coordonnées de la page) : il ne bouge pas, seules les cartes changent de place. */
  cells: DOMRect[];
}

const pageRect = (el: Element) => {
  const r = el.getBoundingClientRect();
  return new DOMRect(r.left + window.scrollX, r.top + window.scrollY, r.width, r.height);
};

const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

/** Sa propre vitrine : places libres pour ajouter, poignées pour l'ordre, retrait. */
export function MyShowcase({ cards, onChanged }: { cards: CardDTO[]; onChanged: () => void }) {
  const [order, setOrder] = useState(cards);
  const [synced, setSynced] = useState(cards);
  // Le profil rechargé fait foi, sauf pendant un glissement.
  const [drag, setDrag] = useState<Drag | null>(null);
  if (cards !== synced && !drag) {
    setSynced(cards);
    setOrder(cards);
  }
  const [arranging, setArranging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [announce, setAnnounce] = useState("");
  /** Déplacement au clavier : pas d'animation (geste répété, le résultat doit être immédiat). */
  const [instant, setInstant] = useState(false);
  const cellsRef = useRef(new Map<number, HTMLLIElement>());
  const handles = useRef(new Map<number, HTMLButtonElement>());

  const save = useCallback(
    async (next: CardDTO[], previous: CardDTO[]) => {
      setOrder(next);
      try {
        await api("/collection/showcase", {
          method: "PUT",
          body: { instanceIds: next.map((c) => c.instanceId) },
        });
        onChanged();
      } catch (err) {
        setOrder(previous);
        toast.error(err instanceof ApiError ? err.message : "Vitrine non enregistrée.");
      }
    },
    [onChanged],
  );

  function shift(index: number, by: number, keyboard = false) {
    const to = index + by;
    if (to < 0 || to >= order.length) return;
    const card = order[index]!;
    setInstant(keyboard);
    void save(move(order, index, to), order);
    setAnnounce(`${card.title} : place ${to + 1} sur ${order.length}.`);
    // Le focus suit la carte (son bouton est recréé à sa nouvelle place).
    if (keyboard) requestAnimationFrame(() => handles.current.get(card.instanceId!)?.focus());
  }

  function remove(card: CardDTO) {
    void save(
      order.filter((c) => c.instanceId !== card.instanceId),
      order,
    );
    setAnnounce(`${card.title} retirée de la vitrine.`);
  }

  function add(card: CardDTO) {
    setPicking(false);
    if (order.length >= SIZE || order.some((c) => c.instanceId === card.instanceId)) return;
    setInstant(false);
    void save([...order, card], order);
    toast.success(`${card.title} ajoutée à ta vitrine.`);
  }

  // Les écouteurs du glissement vivent sur la fenêtre : la carte change de place dans le DOM pendant
  // le geste, ce qui ferait perdre la capture du pointeur à sa poignée.
  const live = useRef({ order, synced, drag });
  useLayoutEffect(() => {
    live.current = { order, synced, drag };
  });
  const dragging = drag?.id ?? null;
  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent) => {
      const { drag: d, order: o } = live.current;
      if (!d || e.pointerId !== d.pointerId) return;
      setDrag({ ...d, x: e.pageX, y: e.pageY });
      // Place visée : celle sous le pointeur, sinon la plus proche.
      let target = 0;
      let best = Infinity;
      d.cells.forEach((r, i) => {
        const inside = e.pageX >= r.left && e.pageX <= r.right && e.pageY >= r.top && e.pageY <= r.bottom;
        const dist = inside ? -1 : Math.hypot(e.pageX - (r.left + r.width / 2), e.pageY - (r.top + r.height / 2));
        if (dist < best) {
          best = dist;
          target = i;
        }
      });
      const from = o.findIndex((c) => c.instanceId === d.id);
      if (from !== target) setOrder(move(o, from, target));
    };
    const onEnd = (e: PointerEvent) => {
      const { drag: d, order: o, synced: before } = live.current;
      if (!d || e.pointerId !== d.pointerId) return;
      setDrag(null);
      if (o.some((c, i) => c.instanceId !== before[i]?.instanceId)) {
        const at = o.findIndex((c) => c.instanceId === d.id);
        setAnnounce(`${o[at]!.title} : place ${at + 1} sur ${o.length}.`);
        void save(o, before);
      }
    };
    // Échap annule le glissement.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrag(null);
      setOrder(live.current.synced);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging, save]);

  function startDrag(e: ReactPointerEvent<HTMLButtonElement>, card: CardDTO) {
    if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    const cell = cellsRef.current.get(card.instanceId!);
    if (!cell) return;
    e.preventDefault();
    const rect = pageRect(cell);
    setInstant(false);
    setDrag({
      id: card.instanceId!,
      pointerId: e.pointerId,
      grabX: e.pageX - rect.left,
      grabY: e.pageY - rect.top,
      x: e.pageX,
      y: e.pageY,
      cells: order.map((c) => pageRect(cellsRef.current.get(c.instanceId!)!)),
    });
  }

  const free = SIZE - order.length;

  return (
    <section aria-labelledby="vitrine-title">
      <div className="mb-[0.9rem] flex items-center gap-3">
        <h2 id="vitrine-title" className="section-title my-0 flex-1">
          Vitrine
          <span className="tnum font-sans text-sm font-semibold normal-case tracking-normal text-faint [font-stretch:100%]">
            {order.length} / {SIZE}
          </span>
        </h2>
        {order.length > 0 && (
          <button
            type="button"
            className={`btn btn-sm ${arranging ? "btn-primary" : ""}`}
            aria-pressed={arranging}
            onClick={() => setArranging((v) => !v)}
          >
            {arranging ? "Terminé" : "Réorganiser"}
          </button>
        )}
      </div>
      {arranging && (
        <p className="hatnote -mt-1 mb-3 text-sm">
          Fais glisser une carte par sa poignée, ou utilise les flèches. Les changements sont enregistrés aussitôt.
        </p>
      )}

      <ol className={GRID} data-arranging={arranging || undefined}>
        {order.map((card, i) => {
          const lifted = drag?.id === card.instanceId;
          const cell = drag?.cells[i];
          return (
            <motion.li
              key={card.instanceId}
              ref={(el) => {
                if (el) cellsRef.current.set(card.instanceId!, el);
                else cellsRef.current.delete(card.instanceId!);
              }}
              layout={lifted ? false : "position"}
              transition={instant ? { duration: 0 } : { type: "spring", duration: 0.38, bounce: 0.12 }}
              className="relative flex flex-col gap-2"
              style={{ zIndex: lifted ? 20 : undefined }}
            >
              {lifted && <div aria-hidden className="slot absolute inset-x-0 top-0 aspect-[5/7]" />}
              <div
                className="pc-showcase-item"
                data-lifted={lifted || undefined}
                style={
                  lifted && drag && cell
                    ? {
                        transform: `translate(${drag.x - drag.grabX - cell.left}px, ${drag.y - drag.grabY - cell.top}px) scale(1.04) rotate(-1.5deg)`,
                      }
                    : undefined
                }
              >
                <Card card={card} href={arranging ? null : undefined} />
              </div>
              {arranging && (
                <div className="pc-arrange-bar" role="group" aria-label={`Place de ${card.title}`}>
                  <button
                    type="button"
                    className="pc-arrange-btn"
                    aria-label={`Avancer ${card.title}`}
                    disabled={i === 0}
                    onClick={() => shift(i, -1)}
                  >
                    <ChevronLeft aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) handles.current.set(card.instanceId!, el);
                      else handles.current.delete(card.instanceId!);
                    }}
                    className="pc-arrange-btn pc-grip"
                    aria-label={`Déplacer ${card.title}, place ${i + 1} sur ${order.length} (flèches gauche et droite)`}
                    onPointerDown={(e) => startDrag(e, card)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                        e.preventDefault();
                        shift(i, -1, true);
                      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                        e.preventDefault();
                        shift(i, 1, true);
                      }
                    }}
                  >
                    <GripVertical aria-hidden className="size-4" />
                    <span className="tnum text-xs font-bold">{i + 1}</span>
                  </button>
                  <button
                    type="button"
                    className="pc-arrange-btn"
                    aria-label={`Reculer ${card.title}`}
                    disabled={i === order.length - 1}
                    onClick={() => shift(i, 1)}
                  >
                    <ChevronRight aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="pc-arrange-btn pc-arrange-remove ml-auto"
                    aria-label={`Retirer ${card.title} de la vitrine`}
                    onClick={() => remove(card)}
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
              )}
            </motion.li>
          );
        })}
        {Array.from({ length: free }, (_, k) => (
          // Sur petit écran, une seule place libre : les suivantes allongeraient la page pour rien.
          <li key={`free-${k}`} className={k > 0 ? "hidden lg:block" : undefined}>
            <button
              type="button"
              className="pc-showcase-empty slot"
              onClick={() => setPicking(true)}
              aria-label={`Ajouter une carte à la place ${order.length + k + 1}`}
            >
              <span aria-hidden className="pc-showcase-empty-num font-display">
                {order.length + k + 1}
              </span>
              <span className="pc-showcase-empty-cta">
                <Plus aria-hidden className="size-4" />
                Ajouter
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <ShowcasePicker
        open={picking}
        pinned={new Set(order.map((c) => c.instanceId!))}
        onPick={add}
        onClose={() => setPicking(false)}
      />
    </section>
  );
}

/** Choix d'une carte de sa collection pour la vitrine (les plus rares d'abord). */
function ShowcasePicker({
  open,
  pinned,
  onPick,
  onClose,
}: {
  open: boolean;
  pinned: Set<number>;
  onPick: (card: CardDTO) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const query = useDebounced(q).trim();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const list = useSWRInfinite<Page<CardDTO>>((i, prev) =>
    !open || (prev && !prev.nextCursor)
      ? null
      : `/collection?sort=rarity&limit=60${query ? `&q=${encodeURIComponent(query)}` : ""}&page=${i}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((s) => s + 1);
  }, [list]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="vitrine-picker-title"
      className="pc-picker m-auto max-h-[min(44rem,calc(100dvh-2rem))] w-[min(52rem,calc(100vw-2rem))] flex-col rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-pop backdrop:bg-black/60 open:flex"
    >
      {open && (
        <>
          <div className="flex items-center gap-3 border-b-2 border-dashed border-line px-5 py-4">
            <h2 id="vitrine-picker-title" className="flex-1 font-display text-2xl uppercase">
              Ajouter à la vitrine
            </h2>
            <button type="button" className="btn btn-sm btn-ghost px-2" onClick={onClose} aria-label="Fermer">
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="px-5 pt-4">
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chercher dans ta collection"
                aria-label="Chercher dans ta collection"
                className="field h-10 min-h-0 pl-8 text-sm"
                autoFocus
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4">
            {list.error ? (
              <ErrorBox error={list.error} retry={() => list.mutate()} />
            ) : !list.data ? (
              <CardSkeletons count={8} />
            ) : items.length === 0 ? (
              <Empty title={query ? "Aucune carte ne correspond" : "Ta collection est vide"}>
                {query ? "Essaie un autre titre." : "Ouvre un paquet pour tirer tes premières cartes."}
              </Empty>
            ) : (
              <>
                <CardGrid dense>
                  {items.map((card) => {
                    const inShowcase = pinned.has(card.instanceId!);
                    const unavailable = inShowcase || !!card.locked;
                    return (
                      <button
                        key={card.instanceId}
                        type="button"
                        className="pc-pick relative text-left disabled:cursor-not-allowed"
                        disabled={unavailable}
                        onClick={() => onPick(card)}
                      >
                        <Card card={card} href={null} className={unavailable ? "opacity-40" : ""} />
                        {unavailable && (
                          <span className="pc-pick-note">
                            {inShowcase ? "Déjà en vitrine" : card.locked === "auction" ? "En vente" : "En échange"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </CardGrid>
                <LoadMore onVisible={loadMore} loading={list.isValidating} done={done} />
              </>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
