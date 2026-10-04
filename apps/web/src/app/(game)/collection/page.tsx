"use client";

import { ECONOMY, MAX_LEVEL, RARITY_LABELS, recycleValue, type Rarity } from "@palacards/game";
import type { CardDTO, Page } from "@palacards/shared";
import { ChevronsUp, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid, RaritySigil } from "@/components/Card";
import { BulkTagDialog, SelectionBar } from "@/components/SelectionBar";
import { CardSkeletons, ConfirmDialog, Empty, ErrorBox, LoadMore, RarityFilter, Select, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";

interface Summary {
  season: number;
  byRarity: { rarity: Rarity; owned: number; total: number }[];
  totalCards: number;
  uniqueCards: number;
  tags: string[];
  seasons: number[];
  /** Boosters à thème dont le joueur possède au moins un article. */
  themes: { id: number; name: string; owned: number; cardCount: number }[];
}

const SORTS = [
  { value: "rarity", label: "Rareté" },
  { value: "date", label: "Plus récentes" },
  { value: "atk", label: "Attaque" },
  { value: "def", label: "Défense" },
  { value: "views", label: "Vues" },
  { value: "title", label: "Titre" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

function Completion({ summary }: { summary: Summary }) {
  return (
    <table className="tnum w-full text-sm">
      <caption className="sr-only">Complétion de la saison {summary.season}</caption>
      <tbody>
        {summary.byRarity.map((r) => {
          const ratio = r.total ? r.owned / r.total : 0;
          return (
            <tr key={r.rarity} className="border-b border-line last:border-0">
              <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-normal">
                <RaritySigil rarity={r.rarity} withLabel />
              </th>
              <td className="w-full py-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(ratio * 100, r.owned ? 1.5 : 0)}%`,
                      background: `var(--color-rarity-${r.rarity.toLowerCase()})`,
                    }}
                  />
                </div>
              </td>
              <td className="whitespace-nowrap py-1.5 pl-3 text-right">
                {fmt(r.owned)} <span className="text-faint">/ {fmt(r.total)}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function CollectionPage() {
  return (
    <Suspense fallback={<CardSkeletons />}>
      <Collection />
    </Suspense>
  );
}

/** Carte sélectionnée : de quoi chiffrer le recyclage et choisir l'action favori sans recharger. */
interface Picked {
  rarity: Rarity;
  shiny: boolean;
  favorite: boolean;
  /** Prise par « Tout sélectionner » alors qu'elle est protégée : favoris et tags oui, recyclage non. */
  guarded: boolean;
}

interface Selectable {
  items: { id: number; rarity: Rarity; shiny: boolean; favorite: boolean; protected: boolean }[];
  protected: number;
  truncated: boolean;
}

interface FusionPreview {
  cards: number;
  levels: number;
  consumed: number;
  forgonePw: number;
  toMax: number;
}

const plural = (n: number, one: string, many = `${one}s`) => (n > 1 ? many : one);

/** Envoie des identifiants par lots (limite d'une requête côté serveur) et cumule un compteur de la réponse. */
async function inBatches<T extends Record<string, unknown>>(
  ids: number[],
  size: number,
  call: (batch: number[]) => Promise<T>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(await call(ids.slice(i, i + size)));
  return out;
}

function Collection() {
  // `?theme=<id>` : ouverte depuis « Mes cartes de ce booster » sur une fiche carte.
  const urlTheme = useSearchParams().get("theme") ?? "";
  const [theme, setTheme] = useState(urlTheme);
  const [seenTheme, setSeenTheme] = useState(urlTheme);
  if (urlTheme !== seenTheme) {
    // Fiche ouverte par-dessus la collection : la page reste montée, l'URL change.
    setSeenTheme(urlTheme);
    setTheme(urlTheme);
  }
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [sort, setSort] = useState<Sort>("rarity");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const [inSummary, setInSummary] = useState(false);
  const [favorites, setFavorites] = useState<"" | "only" | "exclude">("");
  const [shiny, setShiny] = useState(false);
  const [duplicates, setDuplicates] = useState(false);
  const [tag, setTag] = useState("");
  const [season, setSeason] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Map<number, Picked>>(new Map());
  const [confirm, setConfirm] = useState<null | { ids: number[]; gain: number; label: string; kept?: number }>(null);
  const [tagging, setTagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fusion, setFusion] = useState<FusionPreview | null>(null);

  const [selectingAll, setSelectingAll] = useState(false);
  /** Filtre pour lequel « Tout sélectionner » a été utilisé (le bouton devient « Tout désélectionner »). */
  const [allFor, setAllFor] = useState<string | null>(null);

  const summary = useSWR<Summary>("/collection/summary");
  const { mutate } = useSWRConfig();
  /** Filtres en cours, partagés par la liste, « Tout sélectionner » et la fusion en masse. */
  const filters = useMemo(() => {
    const p = new URLSearchParams();
    if (rarity.length) p.set("rarity", rarity.join(","));
    if (query.trim()) {
      p.set("q", query.trim());
      if (inSummary) p.set("inSummary", "true");
    }
    if (favorites) p.set("favorites", favorites);
    if (shiny) p.set("shiny", "true");
    if (duplicates) p.set("duplicates", "true");
    if (tag) p.set("tag", tag);
    if (theme) p.set("theme", theme);
    if (season) p.set("season", season);
    return p.toString();
  }, [rarity, query, inSummary, favorites, shiny, duplicates, tag, theme, season]);
  const params = `${filters}${filters ? "&" : ""}sort=${sort}&limit=60`;

  const list = useSWRInfinite<Page<CardDTO>>((i, prev) =>
    prev && !prev.nextCursor ? null : `/collection?${params}&page=${i}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const total = list.data?.[0]?.total ?? 0;
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((s) => s + 1);
  }, [list]);

  const refresh = () => {
    void list.mutate();
    void summary.mutate();
  };

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Map());
    setAllFor(null);
  }

  async function recycle(ids: number[]) {
    setBusy(true);
    try {
      // Lots de 500 : la limite d'une requête côté serveur.
      const res = await inBatches(ids, 500, (batch) =>
        api<{ gain: number }>("/collection/recycle", { body: { instanceIds: batch } }),
      );
      const gain = res.reduce((s, r) => s + r.gain, 0);
      toast.success(
        `${ids.length} ${plural(ids.length, "carte")} ${plural(ids.length, "recyclée")} : +${fmt(gain)} PW`,
      );
      stopSelecting();
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Recyclage impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function askRecycleDuplicates() {
    try {
      const { instanceIds, gain } = await api<{ instanceIds: number[]; gain: number }>("/collection/duplicates");
      if (instanceIds.length === 0) return toast("Aucun doublon à recycler.");
      setConfirm({
        ids: instanceIds,
        gain,
        label: `${instanceIds.length} ${plural(instanceIds.length, "doublon")}`,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de lister les doublons.");
    }
  }

  async function askFusion() {
    try {
      const preview = await api<FusionPreview>(`/collection/fusions${filters ? `?${filters}` : ""}`);
      if (preview.consumed === 0)
        return toast(filters ? "Aucun doublon à fusionner dans ce filtre." : "Aucun doublon à fusionner.");
      setFusion(preview);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de préparer la fusion.");
    }
  }

  async function fuseAll() {
    setBusy(true);
    try {
      const res = await api<{ cards: number; consumed: number; levels: number }>(
        `/collection/fusions${filters ? `?${filters}` : ""}`,
        { method: "POST" },
      );
      toast.success(
        res.consumed
          ? `${fmt(res.cards)} ${plural(res.cards, "carte")} ${plural(res.cards, "montée")} de ${fmt(res.levels)} ${plural(res.levels, "niveau", "niveaux")}.`
          : "Plus rien à fusionner.",
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Fusion impossible.");
    } finally {
      setBusy(false);
    }
  }

  /** Sélectionne toutes les cartes du filtre en cours, y compris celles pas encore affichées. */
  async function selectAll() {
    setSelectingAll(true);
    try {
      const res = await api<Selectable>(`/collection/selectable${filters ? `?${filters}` : ""}`);
      setSelected(
        new Map(
          res.items.map((i) => [
            i.id,
            { rarity: i.rarity, shiny: i.shiny, favorite: i.favorite, guarded: i.protected },
          ]),
        ),
      );
      setAllFor(res.items.length ? filters : null);
      if (res.items.length === 0) toast("Aucune carte dans ce filtre.");
      if (res.truncated) toast("Sélection limitée aux 5 000 premières cartes.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de tout sélectionner.");
    } finally {
      setSelectingAll(false);
    }
  }

  function toggle(card: CardDTO) {
    setSelected((m) => {
      const next = new Map(m);
      if (next.has(card.instanceId!)) next.delete(card.instanceId!);
      else
        next.set(card.instanceId!, {
          rarity: card.rarity,
          shiny: !!card.shiny,
          favorite: !!card.favorite,
          guarded: false,
        });
      return next;
    });
  }

  const picks = [...selected.entries()];
  const recyclable = picks.filter(([, p]) => !p.guarded);
  const selectedGain = recyclable.reduce((s, [, p]) => s + recycleValue(p.rarity, p.shiny), 0);
  const allFavorite = picks.length > 0 && picks.every(([, p]) => p.favorite);

  async function favoriteSelection() {
    const favorite = !allFavorite;
    const ids = picks.map(([id]) => id);
    setBusy(true);
    try {
      await inBatches(ids, 5000, (batch) =>
        api<{ changed: number }>("/collection/favorite", { body: { instanceIds: batch, favorite } }),
      );
      setSelected((m) => new Map([...m].map(([id, p]) => [id, { ...p, favorite }])));
      toast.success(
        favorite
          ? `${fmt(ids.length)} ${plural(ids.length, "carte")} en favori.`
          : `${fmt(ids.length)} ${plural(ids.length, "carte")} ${plural(ids.length, "retirée")} des favoris.`,
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Favoris non enregistrés.");
    } finally {
      setBusy(false);
    }
  }

  async function tagSelection(action: "add" | "remove", value: string) {
    const ids = picks.map(([id]) => id);
    try {
      const res = await inBatches(ids, 5000, (batch) =>
        api<{ changed: number; skipped: number }>("/collection/tags", {
          body: { instanceIds: batch, [action]: value },
        }),
      );
      const changed = res.reduce((s, r) => s + r.changed, 0);
      const skipped = res.reduce((s, r) => s + r.skipped, 0);
      if (action === "add")
        toast.success(
          `« ${value} » ajouté à ${fmt(changed)} ${plural(changed, "carte")}${skipped ? ` (${fmt(skipped)} déjà à 10 tags)` : ""}.`,
        );
      else toast.success(`« ${value} » retiré de ${fmt(changed)} ${plural(changed, "carte")}.`);
      refresh();
      void mutate("/collection/tags");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Tags non enregistrés.");
    }
  }

  const themeInfo = summary.data?.themes.find((t) => String(t.id) === theme);
  const searchLabel = inSummary ? "Chercher dans le titre et le résumé" : "Filtrer par titre";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Collection</h1>
        <p className="hatnote mt-2 tnum">
          {summary.data
            ? `${fmt(summary.data.totalCards)} cartes, dont ${fmt(summary.data.uniqueCards)} articles différents.`
            : "Chargement de ta collection…"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Barre de filtres */}
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-40 flex-1">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
                />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={inSummary ? "Titre ou mot du résumé" : "Filtrer par titre"}
                  aria-label={searchLabel}
                  className="field h-9 min-h-0 pl-8 text-sm"
                />
              </div>
              <Toggle pressed={inSummary} onChange={setInSummary}>
                Résumé aussi
              </Toggle>
              <Select label="Trier" value={sort} onChange={setSort} options={SORTS} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RarityFilter value={rarity} onChange={setRarity} />
              <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
              <div className="flex gap-1.5" role="group" aria-label="Favoris">
                <Toggle pressed={favorites === "only"} onChange={(on) => setFavorites(on ? "only" : "")}>
                  Favoris
                </Toggle>
                <Toggle pressed={favorites === "exclude"} onChange={(on) => setFavorites(on ? "exclude" : "")}>
                  Sans favoris
                </Toggle>
              </div>
              <Toggle pressed={shiny} onChange={setShiny}>
                Brillantes
              </Toggle>
              <Toggle pressed={duplicates} onChange={setDuplicates}>
                Doublons
              </Toggle>
              {!!summary.data?.tags.length && (
                <Select
                  label="Tag"
                  value={tag}
                  onChange={setTag}
                  options={[{ value: "", label: "Tous" }, ...summary.data.tags.map((t) => ({ value: t, label: t }))]}
                />
              )}
              {!!summary.data?.themes.length && (
                <Select
                  label="Booster"
                  value={theme}
                  onChange={setTheme}
                  options={[
                    { value: "", label: "Tous les boosters" },
                    ...summary.data.themes.map((t) => ({ value: String(t.id), label: t.name })),
                  ]}
                />
              )}
              {(summary.data?.seasons.length ?? 0) > 1 && (
                <Select
                  label="Édition"
                  value={season}
                  onChange={setSeason}
                  options={[
                    { value: "", label: "Toutes" },
                    ...summary.data!.seasons.map((s) => ({ value: String(s), label: `Saison ${s}` })),
                  ]}
                />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="tnum text-muted">
              {list.data ? `${fmt(total)} ${plural(total, "carte")}` : " "}
              {themeInfo && (
                <span className="text-faint">
                  {" "}
                  · {fmt(themeInfo.owned)} / {fmt(themeInfo.cardCount)} articles du booster
                </span>
              )}
            </span>
            {!selecting && (
              <div className="flex flex-wrap gap-2">
                <Link href="/upgrade" className="btn btn-sm">
                  Upgrader
                </Link>
                <button type="button" className="btn btn-sm" onClick={askFusion} disabled={busy}>
                  <ChevronsUp aria-hidden className="size-4" />
                  Fusionner les doublons
                </button>
                <button type="button" className="btn btn-sm" onClick={askRecycleDuplicates}>
                  Recycler les doublons
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setSelecting(true)}
                  disabled={!items.length}
                >
                  Sélectionner
                </button>
              </div>
            )}
          </div>

          {list.error ? (
            <ErrorBox error={list.error} retry={() => list.mutate()} />
          ) : !list.data ? (
            <CardSkeletons />
          ) : items.length === 0 ? (
            <Empty title={summary.data?.totalCards === 0 ? "Ta collection est vide" : "Aucune carte ne correspond"}>
              {summary.data?.totalCards === 0 ? (
                <>
                  Ouvre un paquet pour tirer tes premiers articles.{" "}
                  <Link href="/pulls" className="article-link">
                    Aller aux paquets
                  </Link>
                </>
              ) : inSummary || !query.trim() ? (
                "Change les filtres pour voir d'autres cartes."
              ) : (
                <>
                  Aucun titre ne contient « {query.trim()} ».{" "}
                  <button type="button" className="article-link" onClick={() => setInSummary(true)}>
                    Chercher aussi dans les résumés
                  </button>
                </>
              )}
            </Empty>
          ) : (
            <>
              <CardGrid>
                {items.map((card) =>
                  selecting ? (
                    <button
                      key={card.instanceId}
                      type="button"
                      aria-pressed={selected.has(card.instanceId!)}
                      disabled={!!card.locked}
                      className="text-left transition-transform duration-150 active:scale-[0.98] disabled:opacity-40"
                      onClick={() => toggle(card)}
                    >
                      <Card card={card} href={null} selected={selected.has(card.instanceId!)} />
                    </button>
                  ) : (
                    <Card key={card.instanceId} card={card} />
                  ),
                )}
              </CardGrid>
              <LoadMore onVisible={loadMore} loading={list.isValidating} done={done} />
            </>
          )}
        </div>

        <aside className="infobox lg:sticky lg:top-20">
          <h2 className="infobox-head">Complétion · saison {summary.data?.season ?? "…"}</h2>
          <div className="px-3 py-2">
            {summary.data ? <Completion summary={summary.data} /> : <div className="h-48 animate-pulse" />}
          </div>
        </aside>
      </div>

      {selecting && (
        <SelectionBar
          count={selected.size}
          busy={busy}
          selectAll={
            allFor === filters && selected.size > 0 ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => (setSelected(new Map()), setAllFor(null))}
              >
                Tout désélectionner
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={selectAll}
                disabled={selectingAll || total === 0}
                aria-busy={selectingAll}
              >
                Tout sélectionner
              </button>
            )
          }
          favoriteLabel={allFavorite ? "Retirer des favoris" : "Favori"}
          onFavorite={() => void favoriteSelection()}
          onTag={() => setTagging(true)}
          onRecycle={() => {
            if (!recyclable.length)
              return toast("Rien à recycler : ces cartes sont favorites, brillantes, épinglées ou engagées.");
            setConfirm({
              ids: recyclable.map(([id]) => id),
              gain: selectedGain,
              label: `${fmt(recyclable.length)} ${plural(recyclable.length, "carte")}`,
              kept: selected.size - recyclable.length,
            });
          }}
          recycleLabel={
            <>
              Recycler <span className="tnum">(+{fmt(selectedGain)} PW)</span>
            </>
          }
          onCancel={stopSelecting}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={`Recycler ${confirm?.label ?? ""} ?`}
        confirmLabel={`Recycler (+${fmt(confirm?.gain ?? 0)} PW)`}
        onConfirm={() => confirm && void recycle(confirm.ids)}
        onClose={() => setConfirm(null)}
      >
        Les cartes recyclées disparaissent de ta collection contre des points wiki.
        {confirm?.kept
          ? ` ${fmt(confirm.kept)} ${plural(confirm.kept, "carte")} de la sélection ${confirm.kept > 1 ? "restent" : "reste"} de côté : favorite, brillante, épinglée ou engagée dans une vente ou un échange.`
          : " Les favorites, épinglées et cartes engagées dans une vente ou un échange ne sont jamais recyclées d’office."}
        {confirm && confirm.ids.length > 0 && (
          <span className="mt-2 block text-faint">
            {RARITY_LABELS.C} = {ECONOMY.recycleValue.C} PW, {RARITY_LABELS.L} = {fmt(ECONOMY.recycleValue.L)} PW.
          </span>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!fusion}
        title="Fusionner les doublons ?"
        confirmLabel={`Fusionner ${fmt(fusion?.consumed ?? 0)} ${plural(fusion?.consumed ?? 0, "doublon")}`}
        onConfirm={() => void fuseAll()}
        onClose={() => setFusion(null)}
      >
        {fusion && (
          <>
            <span className="block">
              {fmt(fusion.cards)} {plural(fusion.cards, "carte")} {fusion.cards > 1 ? "gagnent" : "gagne"}{" "}
              {fmt(fusion.levels)} {plural(fusion.levels, "niveau", "niveaux")} (+4 % d’ATK et de DEF chacun)
              {fusion.toMax ? `, dont ${fmt(fusion.toMax)} au niveau ${MAX_LEVEL}` : ""}
              {filters ? ", dans le filtre en cours" : ""}.
            </span>
            <span className="mt-2 block font-semibold text-text">
              {fmt(fusion.consumed)} {plural(fusion.consumed, "doublon")} {plural(fusion.consumed, "consommé")} : tu
              renonces aux {fmt(fusion.forgonePw)} PW de leur recyclage.
            </span>
            <span className="mt-2 block text-faint">
              Jamais consommées : favorites, brillantes, épinglées et cartes engagées. Chaque article monte dans son
              meilleur exemplaire.
            </span>
          </>
        )}
      </ConfirmDialog>

      <BulkTagDialog open={tagging} count={selected.size} onClose={() => setTagging(false)} onApply={tagSelection} />
    </div>
  );
}
