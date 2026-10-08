// Filtres de collection partagés, importés uniquement par des composants client.
import type { Rarity } from "@palacards/game";
import { Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { RarityFilter, Select, Toggle } from "@/components/ui";
import { useDebounced } from "@/lib/use-debounced";

const SORTS = [
  { value: "rarity", label: "Rareté" },
  { value: "date", label: "Plus récentes" },
  { value: "atk", label: "Attaque" },
  { value: "def", label: "Défense" },
  { value: "views", label: "Vues" },
  { value: "title", label: "Titre" },
  { value: "copies", label: "Exemplaires" },
] as const;
export type CollectionSort = (typeof SORTS)[number]["value"];
/** Tri pris d'office avec le filtre « Doublons », tant que le joueur (ou la page) n'en a pas choisi un. */
const DUPLICATES_SORT: CollectionSort = "copies";
/** Sans « Vues » chez les autres : elles donneraient la réponse de « Plus lu » en duel. */
const OTHER_SORTS = SORTS.filter((s) => s.value !== "views");

export interface CollectionFilterState {
  q: string;
  /** La recherche porte aussi sur le résumé de l'article. */
  inSummary: boolean;
  rarity: Rarity[];
  favorites: "" | "only" | "exclude";
  shiny: boolean;
  duplicates: boolean;
  tag: string;
  theme: string;
  season: string;
  sort: CollectionSort;
}

/**
 * Listes des menus déroulants : `/collection/summary` ou `/players/:pseudo/collection/summary` (tags vides si le
 * joueur ne les partage pas).
 */
export interface CollectionFilterOptions {
  tags?: string[];
  themes: { id: number; name: string }[];
  seasons: number[];
}

const EMPTY: CollectionFilterState = {
  q: "",
  inSummary: false,
  rarity: [],
  favorites: "",
  shiny: false,
  duplicates: false,
  tag: "",
  theme: "",
  season: "",
  sort: "rarity",
};

/**
 * Filtres d'une collection (la sienne ou celle d'un autre joueur). `params` : la requête des filtres, sans tri ni
 * pagination (la même sert à la liste, à « Tout sélectionner » et à la fusion) ; `q` : la recherche envoyée.
 * « Doublons » trie par nombre d'exemplaires (et le retirer rend le tri de départ), sauf si le tri a été choisi
 * à la main ou fixé par la page (`init.sort`).
 */
export function useCollectionFilters(init: Partial<CollectionFilterState> = {}) {
  const baseSort = init.sort ?? EMPTY.sort;
  const [value, setValue] = useState<CollectionFilterState>(() => ({
    ...EMPTY,
    ...init,
    sort: init.sort ?? (init.duplicates ? DUPLICATES_SORT : EMPTY.sort),
  }));
  const sortChosen = useRef(init.sort !== undefined);
  const set = useCallback(
    (patch: Partial<CollectionFilterState>) => {
      if (patch.sort !== undefined) sortChosen.current = true;
      const auto = patch.duplicates !== undefined && patch.sort === undefined && !sortChosen.current;
      setValue((v) => ({ ...v, ...patch, ...(auto && { sort: patch.duplicates ? DUPLICATES_SORT : baseSort }) }));
    },
    [baseSort],
  );
  const q = useDebounced(value.q).trim();
  const { rarity, inSummary, favorites, shiny, duplicates, tag, theme, season } = value;
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (rarity.length) p.set("rarity", rarity.join(","));
    if (q) {
      p.set("q", q);
      if (inSummary) p.set("inSummary", "true");
    }
    if (favorites) p.set("favorites", favorites);
    if (shiny) p.set("shiny", "true");
    if (duplicates) p.set("duplicates", "true");
    if (tag) p.set("tag", tag);
    if (theme) p.set("theme", theme);
    if (season) p.set("season", season);
    return p.toString();
  }, [rarity, q, inSummary, favorites, shiny, duplicates, tag, theme, season]);
  return { value, set, q, params };
}

/**
 * Barre de filtres d'une collection : recherche (titre, ou résumé aussi), tri, raretés, brillantes, doublons,
 * tag, booster et édition. Favoris seulement sur sa propre collection (`owner`) : ceux des autres sont privés ; tags
 * d'un autre joueur seulement s'il les partage (le résumé les donne alors).
 * L'upgrader masque les raretés (fixées par l'établi) et les favoris (son propre interrupteur, dans `children`).
 */
export function CollectionFilterBar({
  value: f,
  onChange: set,
  options,
  owner,
  label,
  disabled = false,
  rarities = true,
  favorites = owner,
  children,
  className = "",
}: {
  value: CollectionFilterState;
  onChange: (patch: Partial<CollectionFilterState>) => void;
  options?: CollectionFilterOptions;
  owner: boolean;
  /** Préfixe du nom accessible de la recherche quand plusieurs collections sont à l'écran (échanges). */
  label?: string;
  disabled?: boolean;
  /** Filtre par rareté (masqué quand la page fixe déjà la rareté). */
  rarities?: boolean;
  /** Interrupteurs « Favoris » et « Sans favoris ». */
  favorites?: boolean;
  /** Interrupteurs propres à la page, à la suite des filtres. */
  children?: ReactNode;
  className?: string;
}) {
  const searchLabel = f.inSummary ? "Chercher dans le titre et le résumé" : "Filtrer par titre";
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder={f.inSummary ? "Titre ou mot du résumé" : "Filtrer par titre"}
            aria-label={label ? `${label} : ${searchLabel.toLowerCase()}` : searchLabel}
            className="field h-9 min-h-0 pl-8 text-sm"
            disabled={disabled}
          />
        </div>
        <Toggle pressed={f.inSummary} onChange={(inSummary) => set({ inSummary })}>
          Résumé aussi
        </Toggle>
        <Select label="Trier" value={f.sort} onChange={(sort) => set({ sort })} options={owner ? SORTS : OTHER_SORTS} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {rarities && (
          <>
            <RarityFilter value={f.rarity} onChange={(rarity) => set({ rarity })} />
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          </>
        )}
        {favorites && (
          <div className="flex gap-1.5" role="group" aria-label="Favoris">
            <Toggle pressed={f.favorites === "only"} onChange={(on) => set({ favorites: on ? "only" : "" })}>
              Favoris
            </Toggle>
            <Toggle pressed={f.favorites === "exclude"} onChange={(on) => set({ favorites: on ? "exclude" : "" })}>
              Sans favoris
            </Toggle>
          </div>
        )}
        <Toggle pressed={f.shiny} onChange={(shiny) => set({ shiny })}>
          Brillantes
        </Toggle>
        <Toggle pressed={f.duplicates} onChange={(duplicates) => set({ duplicates })}>
          Doublons
        </Toggle>
        {!!options?.tags?.length && (
          <Select
            label="Tag"
            value={f.tag}
            onChange={(tag) => set({ tag })}
            options={[{ value: "", label: "Tous" }, ...options.tags.map((t) => ({ value: t, label: t }))]}
          />
        )}
        {!!options?.themes.length && (
          <Select
            label="Booster"
            value={f.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: "", label: "Tous les boosters" },
              ...options.themes.map((t) => ({ value: String(t.id), label: t.name })),
            ]}
          />
        )}
        {(options?.seasons.length ?? 0) > 1 && (
          <Select
            label="Édition"
            value={f.season}
            onChange={(season) => set({ season })}
            options={[
              { value: "", label: "Toutes" },
              ...options!.seasons.map((s) => ({ value: String(s), label: `Saison ${s}` })),
            ]}
          />
        )}
        {children}
      </div>
    </div>
  );
}
