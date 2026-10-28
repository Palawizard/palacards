// Filtres de collection partagés, importés uniquement par des composants client.
import type { Rarity } from "@palacards/game";
import { CLASSIC_THEME } from "@palacards/shared";
import { RotateCcw, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LevelFilter, RarityFilter, Select, StatsFilter, Toggle, TriToggle, type FilterMode } from "@/components/ui";
import { useDebounced } from "@/lib/use-debounced";

const SORTS = [
  { value: "rarity", label: "Rareté" },
  { value: "date", label: "Plus récentes" },
  { value: "atk", label: "Attaque" },
  { value: "def", label: "Défense" },
  { value: "views", label: "Vues" },
  { value: "title", label: "Titre" },
  { value: "copies", label: "Exemplaires" },
  { value: "level", label: "Niveau" },
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
  /** ATK et DEF minimales (niveau compris), telles que tapées. */
  minAtk: string;
  minDef: string;
  /** Niveaux cochés (1 à 5) ; vide : tous. */
  levels: number[];
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
  minAtk: "",
  minDef: "",
  levels: [],
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
  const minAtk = useDebounced(value.minAtk).trim();
  const minDef = useDebounced(value.minDef).trim();
  const { rarity, inSummary, favorites, shiny, duplicates, tagged, tag, notTag, theme, season, levels } = value;
  const params = useMemo(
    () =>
      filterParams({
        ...value,
        q,
        minAtk,
        minDef,
      }).toString(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la recherche et les stats arrivent avec un délai (q, minAtk, minDef)
    [rarity, q, inSummary, favorites, shiny, duplicates, tagged, tag, notTag, theme, season, minAtk, minDef, levels],
  );
  /** « Réinitialiser » : filtres à indifférent et recherche vidée ; le tri reste (ou est rendu s'il suivait « Doublons »). */
  const reset = useCallback(() => set(RESET), [set]);
  return { value, set, reset, q, params };
}

/** Valeur valide d'une stat minimale tapée (un entier), sinon rien. */
const statValue = (v: string) => (/^\d{1,5}$/.test(v.trim()) ? String(Math.min(Number(v), 32_767)) : "");

/** Requête des filtres (API comme adresse de la page), sans tri ni pagination. */
function filterParams(f: Omit<CollectionFilterState, "sort">): URLSearchParams {
  const p = new URLSearchParams();
  if (f.rarity.length) p.set("rarity", f.rarity.join(","));
  const q = f.q.trim();
  if (q) {
    p.set("q", q);
    if (f.inSummary) p.set("inSummary", "true");
  }
  if (f.favorites) p.set("favorites", f.favorites);
  if (f.shiny) p.set("shiny", f.shiny);
  if (f.duplicates) p.set("duplicates", f.duplicates);
  if (f.tagged) p.set("tagged", f.tagged);
  if (f.tag) p.set("tag", f.tag);
  if (f.notTag) p.set("notTag", f.notTag);
  if (f.theme) p.set("theme", f.theme);
  if (f.season) p.set("season", f.season);
  if (statValue(f.minAtk)) p.set("minAtk", statValue(f.minAtk));
  if (statValue(f.minDef)) p.set("minDef", statValue(f.minDef));
  if (f.levels.length) p.set("levels", [...f.levels].sort().join(","));
  return p;
}

/**
 * Nombre de filtres qui réduisent la liste par rapport à l'arrivée sur la page (`base`) : la recherche compte pour
 * un, l'option « Résumé aussi » seule pour rien.
 */
export function activeFilterCount(f: CollectionFilterState, base: Partial<CollectionFilterState> = {}): number {
  const ref = { ...RESET, ...base };
  return (Object.keys(RESET) as (keyof typeof RESET)[]).filter((k) => {
    if (k === "inSummary") return false;
    const v = f[k];
    const r = ref[k];
    if (k === "minAtk" || k === "minDef") return statValue(v as string) !== statValue(r as string);
    if (k === "q") return (v as string).trim() !== (r as string).trim();
    return Array.isArray(v) ? [...v].sort().join() !== [...(r as unknown[])].sort().join() : v !== r;
  }).length;
}

/** Un filtre ou une recherche réduit la liste. */
export function filtersActive(f: CollectionFilterState, base: Partial<CollectionFilterState> = {}): boolean {
  return activeFilterCount(f, base) > 0;
}

/** Marqueur d'adresse : filtres choisis à la main, tous retirés (sinon la page reprendrait ceux de l'arrivée). */
const NO_FILTER = "filtres=aucun";

/**
 * Filtres lus dans l'adresse de la page (Collection, Upgrader), à passer à `useCollectionFilters` : l'adresse fait
 * foi dès qu'elle en porte un ; sinon, ceux de l'arrivée (`base`).
 */
export function useUrlFilters(base: Partial<CollectionFilterState> = {}): Partial<CollectionFilterState> {
  const search = useSearchParams();
  const [initial] = useState(() => {
    const get = (k: string) => search.get(k) ?? "";
    const keys = [...Object.keys(RESET), "sort", "filtres"];
    if (!keys.some((k) => search.has(k))) return base;
    const mode = (k: string): FilterMode => (get(k) === "only" || get(k) === "exclude" ? (get(k) as FilterMode) : "");
    const sort = SORTS.find((x) => x.value === get("sort"))?.value;
    return {
      q: get("q"),
      inSummary: get("inSummary") === "true",
      rarity: get("rarity")
        .split(",")
        .filter((r): r is Rarity => ["C", "PC", "R", "SR", "UR", "L"].includes(r)),
      favorites: mode("favorites"),
      shiny: mode("shiny"),
      duplicates: mode("duplicates"),
      tagged: mode("tagged"),
      tag: get("tag"),
      notTag: get("notTag"),
      theme: get("theme"),
      season: /^\d+$/.test(get("season")) ? get("season") : "",
      minAtk: statValue(get("minAtk")),
      minDef: statValue(get("minDef")),
      levels: [...new Set(get("levels").split(",").map(Number))].filter((l) => l >= 1 && l <= 5),
      ...(sort ? { sort } : base.sort ? { sort: base.sort } : {}),
    };
  });
  return initial;
}

/**
 * Garde les filtres dans l'adresse de la page (`path`, ex. `/collection`), sans navigation : rechargement, retour
 * et lien partagé retrouvent la même liste. Les filtres de l'arrivée (`base`) laissent l'adresse nue.
 */
export function useFiltersInUrl(path: string, f: CollectionFilterState, base: Partial<CollectionFilterState> = {}) {
  const qs = useMemo(() => {
    const ref = { ...EMPTY, ...base };
    const p = filterParams(f);
    if (f.sort !== ref.sort) p.set("sort", f.sort);
    const mine = p.toString();
    const start = filterParams(ref).toString();
    if (mine === start && f.sort === ref.sort) return "";
    return mine || NO_FILTER;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `base` : valeurs d'arrivée, fixes pour la page
  }, [f]);
  useEffect(() => {
    // Fiche ouverte par-dessus la page : l'adresse est la sienne, on n'y touche pas.
    if (!window.location.pathname.endsWith(path)) return;
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
  }, [path, qs]);
}

/**
 * Barre de filtres d'une collection : recherche (titre, ou résumé aussi), tri, raretés, brillantes, doublons,
 * tag, booster, édition, ATK et DEF minimales et niveaux (tous cumulés). Favoris, brillantes, doublons et « Taguées » ont trois états (indifférent, seulement,
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
  base,
  children,
  className = "",
}: {
  value: CollectionFilterState;
  onChange: (patch: Partial<CollectionFilterState>) => void;
  /** Bouton « Réinitialiser », affiché dès qu'un filtre ou une recherche réduit la liste. */
  onReset?: () => void;
  /** Filtres de l'arrivée sur la page, que « Réinitialiser » rend (non comptés comme actifs). */
  base?: Partial<CollectionFilterState>;
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
  const count = activeFilterCount(f, base);
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
        <StatsFilter
          minAtk={f.minAtk}
          minDef={f.minDef}
          onChange={(patch) => set(patch)}
          hint="Niveau compris, comme sur la carte"
        />
        <LevelFilter value={f.levels} onChange={(levels) => set({ levels })} />
        {children}
        {onReset && count > 0 && (
          <span className="flex items-center gap-1">
            <span className="tnum text-xs font-semibold text-muted" aria-live="polite">
              {count} filtre{count > 1 ? "s" : ""} actif{count > 1 ? "s" : ""}
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
              <RotateCcw aria-hidden className="size-4" />
              Réinitialiser
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
