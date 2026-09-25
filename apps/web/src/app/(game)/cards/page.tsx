"use client";

import type { Rarity } from "@palacards/game";
import type { CardDTO, Page } from "@palacards/shared";
import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid } from "@/components/Card";
import { CardSkeletons, Empty, ErrorBox, LoadMore, RarityFilter, Select } from "@/components/ui";
import { useDebounced } from "@/lib/use-debounced";

const SORTS = [
  { value: "views", label: "Les plus lues" },
  { value: "atk", label: "Attaque" },
  { value: "def", label: "Défense" },
  { value: "title", label: "Titre (A → Z)" },
] as const;
const OWNED = [
  { value: "", label: "Toutes" },
  { value: "yes", label: "Possédées" },
  { value: "no", label: "Pas encore" },
] as const;

function Catalog() {
  const router = useRouter();
  const search = useSearchParams();
  const [q, setQ] = useState(search.get("q") ?? "");
  const query = useDebounced(q);
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("views");
  const [owned, setOwned] = useState<(typeof OWNED)[number]["value"]>("");
  const [minAtk, setMinAtk] = useState("");
  const [minDef, setMinDef] = useState("");

  const params = useMemo(() => {
    const p = new URLSearchParams({ sort, limit: "48" });
    if (query.trim().length >= 3) p.set("q", query.trim());
    if (rarity.length) p.set("rarity", rarity.join(","));
    if (owned) p.set("owned", owned);
    if (/^\d+$/.test(minAtk)) p.set("minAtk", minAtk);
    if (/^\d+$/.test(minDef)) p.set("minDef", minDef);
    return p.toString();
  }, [query, rarity, sort, owned, minAtk, minDef]);

  const list = useSWRInfinite<Page<CardDTO> & { approximate?: boolean }>(
    (i, prev) =>
      prev && !prev.nextCursor ? null : `/cards?${params}${i && prev?.nextCursor ? `&cursor=${prev.nextCursor}` : ""}`,
    { revalidateFirstPage: false },
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((s) => s + 1);
  }, [list]);
  const approximate = !!list.data?.[0]?.approximate;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="page-title">Toutes les cartes</h1>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3">
        <form
          role="search"
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            router.replace(q.trim() ? `/cards?q=${encodeURIComponent(q.trim())}` : "/cards");
          }}
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-[1.1rem] -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Einstein, tour Eiffel, Zidane…"
            aria-label="Chercher un article"
            className="field h-11 pl-10 text-base"
            autoFocus={!!search.get("q")}
          />
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <RarityFilter value={rarity} onChange={setRarity} />
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Select label="Possession" value={owned} onChange={setOwned} options={OWNED} />
          <Select label="Trier" value={sort} onChange={setSort} options={SORTS} />
          <details className="group relative">
            <summary className="chip cursor-pointer list-none">Stats minimales</summary>
            <div className="absolute left-0 top-9 z-20 flex w-60 flex-col gap-2 rounded-xl border border-line-strong bg-panel p-3 shadow-pop">
              <label className="text-sm">
                <span className="label">ATK minimale</span>
                <input
                  inputMode="numeric"
                  className="field h-8 min-h-0"
                  value={minAtk}
                  onChange={(e) => setMinAtk(e.target.value)}
                  placeholder="100 à 9 999"
                />
              </label>
              <label className="text-sm">
                <span className="label">DEF minimale</span>
                <input
                  inputMode="numeric"
                  className="field h-8 min-h-0"
                  value={minDef}
                  onChange={(e) => setMinDef(e.target.value)}
                  placeholder="100 à 9 999"
                />
              </label>
            </div>
          </details>
        </div>
      </div>

      {list.error ? (
        <ErrorBox error={list.error} retry={() => list.mutate()} />
      ) : !list.data ? (
        <CardSkeletons />
      ) : items.length === 0 ? (
        <Empty title="Aucun article trouvé">Essaie un autre mot ou retire des filtres.</Empty>
      ) : (
        <>
          {approximate && (
            <p className="hatnote -mt-2" role="status">
              Aucun titre ne contient tous ces mots : voici les plus proches.
            </p>
          )}
          <CardGrid>
            {items.map((card) => (
              <Card key={card.cardId} card={card} />
            ))}
          </CardGrid>
          <LoadMore onVisible={loadMore} loading={list.isValidating} done={done} />
        </>
      )}
    </div>
  );
}

/** Remonte le catalogue quand la recherche de l'en-tête change l'URL. */
function CatalogFromUrl() {
  const q = useSearchParams().get("q") ?? "";
  return <Catalog key={q} />;
}

export default function CardsPage() {
  return (
    <Suspense fallback={<CardSkeletons />}>
      <CatalogFromUrl />
    </Suspense>
  );
}
