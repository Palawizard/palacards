"use client";

import { ECONOMY, RARITY_LABELS, type Rarity } from "@palacards/game";
import type { CardDTO, Page } from "@palacards/shared";
import { Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid, RaritySigil } from "@/components/Card";
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
}

const SORTS = [
  { value: "date", label: "Plus récentes" },
  { value: "rarity", label: "Rareté" },
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
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [sort, setSort] = useState<Sort>("date");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const [favorites, setFavorites] = useState(false);
  const [duplicates, setDuplicates] = useState(false);
  const [tag, setTag] = useState("");
  const [season, setSeason] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Map<number, Rarity>>(new Map());
  const [confirm, setConfirm] = useState<null | { ids: number[]; gain: number; label: string }>(null);

  const summary = useSWR<Summary>("/collection/summary");
  const params = useMemo(() => {
    const p = new URLSearchParams({ sort, limit: "60" });
    if (rarity.length) p.set("rarity", rarity.join(","));
    if (query.trim()) p.set("q", query.trim());
    if (favorites) p.set("favorites", "true");
    if (duplicates) p.set("duplicates", "true");
    if (tag) p.set("tag", tag);
    if (season) p.set("season", season);
    return p.toString();
  }, [rarity, sort, query, favorites, duplicates, tag, season]);

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

  async function recycle(ids: number[]) {
    try {
      // Lots de 500 : la limite d'une requête côté serveur.
      let gain = 0;
      for (let i = 0; i < ids.length; i += 500) {
        gain += (await api<{ gain: number }>("/collection/recycle", { body: { instanceIds: ids.slice(i, i + 500) } }))
          .gain;
      }
      toast.success(
        `${ids.length} carte${ids.length > 1 ? "s" : ""} recyclée${ids.length > 1 ? "s" : ""} : +${fmt(gain)} PW`,
      );
      setSelected(new Map());
      setSelecting(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Recyclage impossible.");
    }
  }

  async function askRecycleDuplicates() {
    try {
      const { instanceIds, gain } = await api<{ instanceIds: number[]; gain: number }>("/collection/duplicates");
      if (instanceIds.length === 0) return toast("Aucun doublon à recycler.");
      setConfirm({
        ids: instanceIds,
        gain,
        label: `${instanceIds.length} doublon${instanceIds.length > 1 ? "s" : ""}`,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de lister les doublons.");
    }
  }

  const selectedGain = [...selected.values()].reduce((s, r) => s + ECONOMY.recycleValue[r], 0);

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
          <div className="flex flex-col gap-3 rounded-md border border-line bg-panel p-3">
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
                  placeholder="Filtrer par titre"
                  aria-label="Filtrer par titre"
                  className="field h-9 min-h-0 pl-8 text-sm"
                />
              </div>
              <Select label="Trier" value={sort} onChange={setSort} options={SORTS} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RarityFilter value={rarity} onChange={setRarity} />
              <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
              <Toggle pressed={favorites} onChange={setFavorites}>
                Favoris
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
            <span className="tnum text-muted">{list.data ? `${fmt(total)} carte${total > 1 ? "s" : ""}` : " "}</span>
            <div className="flex flex-wrap gap-2">
              {selecting ? (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => (setSelecting(false), setSelected(new Map()))}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={selected.size === 0}
                    onClick={() =>
                      setConfirm({
                        ids: [...selected.keys()],
                        gain: selectedGain,
                        label: `${selected.size} carte${selected.size > 1 ? "s" : ""}`,
                      })
                    }
                  >
                    Recycler {selected.size || ""} <span className="tnum">(+{fmt(selectedGain)} PW)</span>
                  </button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
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
              ) : (
                "Change les filtres pour voir d'autres cartes."
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
                      onClick={() =>
                        setSelected((m) => {
                          const next = new Map(m);
                          if (next.has(card.instanceId!)) next.delete(card.instanceId!);
                          else next.set(card.instanceId!, card.rarity);
                          return next;
                        })
                      }
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

      <ConfirmDialog
        open={!!confirm}
        title={`Recycler ${confirm?.label ?? ""} ?`}
        confirmLabel={`Recycler (+${fmt(confirm?.gain ?? 0)} PW)`}
        onConfirm={() => confirm && recycle(confirm.ids)}
        onClose={() => setConfirm(null)}
      >
        Les cartes recyclées disparaissent de ta collection contre des points wiki. Les favorites, épinglées et cartes
        engagées dans une vente ou un échange ne sont jamais recyclées d’office.
        {confirm && confirm.ids.length > 0 && (
          <span className="mt-2 block text-faint">
            {RARITY_LABELS.C} = {ECONOMY.recycleValue.C} PW, {RARITY_LABELS.L} = {fmt(ECONOMY.recycleValue.L)} PW.
          </span>
        )}
      </ConfirmDialog>
    </div>
  );
}
