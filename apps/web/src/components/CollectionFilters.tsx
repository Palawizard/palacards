// Filtres de collection partagés, importés uniquement par des composants client.
import type { Rarity } from "@palacards/game";
import { CLASSIC_THEME } from "@palacards/shared";
import { RotateCcw, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { RarityFilter, Select, Toggle, TriToggle, type FilterMode } from "@/components/ui";
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
/** Option du menu « Booster » : les articles d'aucun booster à thème, donc des seuls paquets classiques. */
const CLASSIC_THEME_LABEL = "Classique";
/** Sans « Vues » chez les autres : elles donneraient la réponse de « Plus lu » en duel. */
const OTHER_SORTS = SORTS.filter((s) => s.value !== "views");

export interface CollectionFilterState {
  q: string;
  /** La recherche porte aussi sur le résumé de l'article. */
  inSummary: boolean;
  rarity: Rarity[];
  favorites: FilterMode;
  shiny: FilterMode;
  duplicates: FilterMode;
  /** Cartes portant au moins un tag. */
  tagged: FilterMode;
  /** Seulement les cartes portant ce tag. */
  tag: string;
  /** Toutes sauf les cartes portant ce tag (l'un ou l'autre, choisi dans le même menu). */
  notTag: string;
  /** Id d'un booster à thème, ou `classic` (articles d'aucun booster à thème). */
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
  shiny: "",
  duplicates: "",
  tagged: "",
  tag: "",
  notTag: "",
  theme: "",
  season: "",
  sort: "rarity",
};
/** Ce que remet « Réinitialiser » : tout sauf le tri. */
const { sort: _sort, ...RESET } = EMPTY;

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
    sort: init.sort ?? (init.duplicates === "only" ? DUPLICATES_SORT : EMPTY.sort),
  }));
  const sortChosen = useRef(init.sort !== undefined);
  const set = useCallback(
    (patch: Partial<CollectionFilterState>) => {
      if (patch.sort !== undefined) sortChosen.current = true;
      const auto = patch.duplicates !== undefined && patch.sort === undefined && !sortChosen.current;
      setValue((v) => ({
        ...v,
        ...patch,
        ...(auto && { sort: patch.duplicates === "only" ? DUPLICATES_SORT : baseSort }),
      }));
    },
    [baseSort],
  );
  const q = useDebounced(value.q).trim();
  const { rarity, inSummary, favorites, shiny, duplicates, tagged, tag, notTag, theme, season } = value;
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (rarity.length) p.set("rarity", rarity.join(","));
    if (q) {
      p.set("q", q);
      if (inSummary) p.set("inSummary", "true");
    }
    if (favorites) p.set("favorites", favorites);
    if (shiny) p.set("shiny", shiny);
    if (duplicates) p.set("duplicates", duplicates);
    if (tagged) p.set("tagged", tagged);
    if (tag) p.set("tag", tag);
    if (notTag) p.set("notTag", notTag);
    if (theme) p.set("theme", theme);
    if (season) p.set("season", season);
    return p.toString();
  }, [rarity, q, inSummary, favorites, shiny, duplicates, tagged, tag, notTag, theme, season]);
  /** « Réinitialiser » : filtres à indifférent et recherche vidée ; le tri reste (ou est rendu s'il suivait « Doublons »). */
  const reset = useCallback(() => set(RESET), [set]);
  return { value, set, reset, q, params };
}

/** Un filtre ou une recherche réduit la liste. */
export function filtersActive(f: CollectionFilterState): boolean {
  return (Object.keys(RESET) as (keyof typeof RESET)[]).some((k) => {
    const v = f[k];
    return Array.isArray(v) ? v.length > 0 : v !== RESET[k];
  });
}

/**
 * Barre de filtres d'une collection : recherche (titre, ou résumé aussi), tri, raretés, brillantes, doublons,
 * tag, booster et édition. Favoris, brillantes, doublons et « Taguées » ont trois états (indifférent, seulement,
 * sauf) ; le menu des tags garde un tag ou l'écarte. Favoris seulement sur sa propre collection (`owner`) : ceux des autres sont privés ; tags
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
  onReset,
  children,
  className = "",
}: {
  value: CollectionFilterState;
  onChange: (patch: Partial<CollectionFilterState>) => void;
  /** Bouton « Réinitialiser », affiché dès qu'un filtre ou une recherche réduit la liste. */
  onReset?: () => void;
  options?: CollectionFilterOptions;
  owner: boolean;
  /** Préfixe du nom accessible de la recherche quand plusieurs collections sont à l'écran (échanges). */
  label?: string;
  disabled?: boolean;
  /** Filtre par rareté (masqué quand la page fixe déjà la rareté). */
  rarities?: boolean;
  /** Filtre « Favoris » (seulement, ou sans). */
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
          <TriToggle
            value={f.favorites}
            onChange={(v) => set({ favorites: v })}
            label="Favoris"
            excludeLabel="Sans favoris"
          />
        )}
        <TriToggle
          value={f.shiny}
          onChange={(shiny) => set({ shiny })}
          label="Brillantes"
          excludeLabel="Sans brillantes"
        />
        <TriToggle
          value={f.duplicates}
          onChange={(duplicates) => set({ duplicates })}
          label="Doublons"
          excludeLabel="Sans doublons"
        />
        {!!options?.tags?.length && (
          <>
            <TriToggle
              value={f.tagged}
              onChange={(tagged) => set({ tagged })}
              label="Taguées"
              excludeLabel="Sans tag"
            />
            <Select
              label="Tag"
              // Un seul menu pour « seulement ce tag » (+) et « sauf ce tag » (−) : préfixe interne au menu.
              value={f.tag ? `+${f.tag}` : f.notTag ? `-${f.notTag}` : ""}
              onChange={(v) =>
                set({ tag: v.startsWith("+") ? v.slice(1) : "", notTag: v.startsWith("-") ? v.slice(1) : "" })
              }
              options={[
                { value: "", label: "Tous" },
                ...options.tags.map((t) => ({ value: `+${t}`, label: t })),
                ...options.tags.map((t) => ({ value: `-${t}`, label: `Sauf « ${t} »` })),
              ]}
            />
          </>
        )}
        {!!options?.themes.length && (
          <Select
            label="Booster"
            value={f.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: "", label: "Tous les boosters" },
              { value: CLASSIC_THEME, label: CLASSIC_THEME_LABEL },
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
        {onReset && filtersActive(f) && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
            <RotateCcw aria-hidden className="size-4" />
            Réinitialiser
          </button>
        )}
      </div>
    </div>
  );
}
