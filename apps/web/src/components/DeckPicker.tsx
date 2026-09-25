// Sélecteur de deck (importé uniquement par des composants client).
import { DECK_SIZE } from "@palacards/game";
import type { CardDTO, Page } from "@palacards/shared";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { fmt } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { RaritySigil } from "./Card";
import { Thumb } from "./market";

/** Compose un deck ordonné de 5 cartes (la manche 1 oppose les cartes n° 1, etc.). */
export function DeckPicker({ deck, onChange }: { deck: CardDTO[]; onChange: (d: CardDTO[]) => void }) {
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const { data } = useSWR<Page<CardDTO>>(
    `/collection?sort=atk&limit=60${query.trim().length >= 2 ? `&q=${encodeURIComponent(query.trim())}` : ""}`,
  );
  const chosen = new Set(deck.map((c) => c.instanceId));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...deck];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted">
          Ton deck{" "}
          <span className="tnum text-faint">
            ({deck.length}/{DECK_SIZE})
          </span>
        </h3>
        <ol className="flex flex-col gap-1.5">
          {Array.from({ length: DECK_SIZE }, (_, i) => {
            const c = deck[i];
            return (
              <li
                key={i}
                className={`flex min-h-12 items-center gap-2 rounded-xl px-2 py-1.5 ${c ? "border border-line bg-panel" : "slot"}`}
              >
                <span className="tnum w-5 text-center font-display text-lg text-faint">{i + 1}</span>
                {c ? (
                  <>
                    <Thumb card={c} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 font-display">{c.title}</span>
                      <span className="tnum flex items-center gap-1.5 text-xs text-faint">
                        <RaritySigil rarity={c.rarity} /> ATK {fmt(c.atk)} · DEF {fmt(c.def)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost px-1.5"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label="Monter"
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost px-1.5"
                      onClick={() => move(i, 1)}
                      disabled={i === deck.length - 1}
                      aria-label="Descendre"
                    >
                      <ArrowDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost px-1.5"
                      onClick={() => onChange(deck.filter((_, j) => j !== i))}
                      aria-label={`Retirer ${c.title}`}
                    >
                      <X className="size-4" />
                    </button>
                  </>
                ) : (
                  <span className="text-sm text-faint">Emplacement libre</span>
                )}
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className="btn btn-sm mt-2"
          disabled={!data?.items.length}
          onClick={() => onChange((data?.items ?? []).slice(0, DECK_SIZE))}
        >
          Mes {DECK_SIZE} meilleures attaques
        </button>
      </div>
      <div>
        <div className="relative mb-2">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
          />
          <input
            className="field h-9 min-h-0 pl-8 text-sm"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chercher dans ma collection"
            aria-label="Chercher dans ma collection"
          />
        </div>
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-xl border border-line bg-bg p-1">
          {data?.items.map((c) => (
            <li key={c.instanceId}>
              <button
                type="button"
                disabled={chosen.has(c.instanceId) || deck.length >= DECK_SIZE}
                onClick={() => onChange([...deck, c])}
                className="flex w-full items-center gap-2 rounded p-1.5 text-left transition-colors duration-150 hover:bg-panel-2 disabled:opacity-40"
              >
                <Thumb card={c} size="sm" />
                <span className="line-clamp-1 flex-1 font-display">{c.title}</span>
                <span className="tnum text-xs text-faint">
                  {fmt(c.atk)} / {fmt(c.def)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
