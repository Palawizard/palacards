// Choix d'une carte de sa collection dans une fenêtre (vitrine, bannière du profil ; composants client uniquement).
import type { CardDTO, Page } from "@palacards/shared";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid } from "@/components/Card";
import { CardSkeletons, Empty, ErrorBox, LoadMore } from "@/components/ui";
import { useDebounced } from "@/lib/use-debounced";

/**
 * Fenêtre de choix parmi ses cartes (les plus rares d'abord), avec recherche par titre.
 * `unavailable` renvoie la raison d'une carte non choisissable (affichée dessus), ou null.
 */
export function CardPicker({
  open,
  title,
  intro,
  unavailable,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  intro?: ReactNode;
  unavailable?: (card: CardDTO) => string | null;
  onPick: (card: CardDTO) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
      aria-labelledby={titleId}
      className="pc-picker m-auto max-h-[min(44rem,calc(100dvh-2rem))] w-[min(52rem,calc(100vw-2rem))] flex-col rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-pop backdrop:bg-black/60 open:flex"
    >
      {open && (
        <>
          <div className="flex items-center gap-3 border-b-2 border-dashed border-line px-5 py-4">
            <h2 id={titleId} className="flex-1 font-display text-2xl uppercase">
              {title}
            </h2>
            <button type="button" className="btn btn-sm btn-ghost px-2" onClick={onClose} aria-label="Fermer">
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="px-5 pt-4">
            {intro && <p className="mb-3 text-sm text-muted">{intro}</p>}
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
                    const note = unavailable?.(card) ?? null;
                    return (
                      <button
                        key={card.instanceId}
                        type="button"
                        className="pc-pick relative text-left disabled:cursor-not-allowed"
                        disabled={note !== null}
                        onClick={() => onPick(card)}
                      >
                        <Card card={card} href={null} className={note !== null ? "opacity-40" : ""} />
                        {note !== null && <span className="pc-pick-note">{note}</span>}
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
