"use client";

import type { Rarity } from "@palacards/game";
import type { CardDTO, Page, ThemeDTO } from "@palacards/shared";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid } from "@/components/Card";
import { CardSkeletons, Empty, ErrorBox, LoadMore, RarityFilter, Select, Toggle } from "@/components/ui";
import { fmt } from "@/lib/format";
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
  // Comme dans la collection : la recherche porte aussi sur le résumé de l'article.
  const [inSummary, setInSummary] = useState(false);
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("views");
  const [owned, setOwned] = useState<(typeof OWNED)[number]["value"]>("");
  const [minAtk, setMinAtk] = useState("");
  const [minDef, setMinDef] = useState("");
  // Articles d'un booster à thème (lien « Voir les articles » de la page Paquets).
  const [theme, setTheme] = useState(search.get("theme") ?? "");
  const themes = useSWR<ThemeDTO[]>("/themes");
  const themeOptions = useMemo(
    () => [
      { value: "", label: "Tous les articles" },
      ...(themes.data ?? []).map((t) => ({ value: String(t.id), label: t.name })),
    ],
    [themes.data],
  );
  const chosen = themes.data?.find((t) => String(t.id) === theme);

  const params = useMemo(() => {
    const p = new URLSearchParams({ sort, limit: "48" });
    if (query.trim().length >= 3) {
      p.set("q", query.trim());
      if (inSummary) p.set("inSummary", "true");
    }
    if (rarity.length) p.set("rarity", rarity.join(","));
    if (owned) p.set("owned", owned);
    if (/^\d+$/.test(minAtk)) p.set("minAtk", minAtk);
    if (/^\d+$/.test(minDef)) p.set("minDef", minDef);
    if (/^\d+$/.test(theme)) p.set("theme", theme);
    return p.toString();
  }, [query, inSummary, rarity, sort, owned, minAtk, minDef, theme]);

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
      <div>
        <h1 className="page-title">{chosen ? chosen.name : "Toutes les cartes"}</h1>
        {chosen && (
          <p className="hatnote mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Les {fmt(chosen.cardCount)} articles du booster à thème, à tirer dans ses boosters.{" "}
              <Link href="/pulls" className="article-link">
                Voir le booster
              </Link>
            </span>
            <button type="button" className="chip" onClick={() => setTheme("")}>
              <X aria-hidden className="size-3.5" />
              Tous les articles
            </button>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3">
        <div className="flex flex-wrap items-center gap-2">
          <form
            role="search"
            className="relative min-w-60 flex-1"
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
              placeholder={inSummary ? "Titre ou mot du résumé" : "Einstein, tour Eiffel, Zidane…"}
              aria-label={inSummary ? "Chercher dans le titre et le résumé" : "Chercher un article"}
              className="field h-11 pl-10 text-base"
              autoFocus={!!search.get("q")}
            />
          </form>
          <Toggle pressed={inSummary} onChange={setInSummary}>
            Résumé aussi
          </Toggle>
        </div>
        {inSummary && (
          <p className="text-xs text-faint">
            Le résumé n’est connu que pour les articles déjà ouverts ou vus dans le jeu : les autres se trouvent par
            leur titre.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <RarityFilter value={rarity} onChange={setRarity} />
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Select label="Possession" value={owned} onChange={setOwned} options={OWNED} />
          {themeOptions.length > 1 && (
            <Select label="Booster" value={theme} onChange={setTheme} options={themeOptions} />
          )}
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

/** Remonte le catalogue quand la recherche de l'en-tête (ou un lien vers un booster) change l'URL. */
function CatalogFromUrl() {
  const search = useSearchParams();
  return <Catalog key={`${search.get("q") ?? ""}|${search.get("theme") ?? ""}`} />;
}

export default function CardsPage() {
  return (
    <Suspense fallback={<CardSkeletons />}>
      <CatalogFromUrl />
    </Suspense>
  );
}
