"use client";

import { minNextBid, type Rarity } from "@palacards/game";
import type { AuctionDTO, CardDTO } from "@palacards/shared";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Card, CardGrid } from "@/components/Card";
import { AuctionRow } from "@/components/market";
import { Empty, ErrorBox, RarityFilter, Select } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useConnection, useSocket, useSocketEvent } from "@/lib/game";
import { useNow } from "@/lib/use-now";
import { useDebounced } from "@/lib/use-debounced";

const TABS = [
  { value: "all", label: "Toutes les ventes" },
  { value: "bidding", label: "Mes enchères" },
  { value: "mine", label: "Mes ventes" },
  { value: "wishlist", label: "Ma wishlist" },
] as const;
type Tab = (typeof TABS)[number]["value"];
const SORTS = [
  { value: "ending", label: "Finissent bientôt" },
  { value: "recent", label: "Plus récentes" },
  { value: "price", label: "Prix" },
] as const;

function Wishlist() {
  const { data, error, mutate } = useSWR<(CardDTO & { onSale: number | null })[]>("/wishlist");
  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!data) return <div className="h-60 animate-pulse rounded-md bg-panel" />;
  if (!data.length) {
    return (
      <Empty title="Ta wishlist est vide">
        Ajoute des cartes depuis leur fiche : tu seras prévenu dès qu’elles sont mises en vente.{" "}
        <Link href="/cards" className="article-link">
          Parcourir le catalogue
        </Link>
      </Empty>
    );
  }
  return (
    <CardGrid>
      {data.map((c) => (
        <div key={c.cardId} className="flex flex-col gap-1.5">
          <Card card={c} />
          <div className="flex items-center justify-between gap-2 text-xs">
            {c.onSale ? (
              <span className="font-semibold text-accent">En vente</span>
            ) : (
              <span className="text-faint">Pas en vente</span>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost px-2 text-xs"
              onClick={async () => {
                try {
                  await api(`/wishlist/${c.cardId}`, { method: "DELETE" });
                  void mutate();
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : "Action impossible.");
                }
              }}
            >
              Retirer
            </button>
          </div>
        </div>
      ))}
    </CardGrid>
  );
}

function Market() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get("scope"))?.value ?? "all") as Tab;
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("ending");
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [changed, setChanged] = useState<Set<number>>(new Set());
  const now = useNow(1000);
  const socket = useSocket();
  const connection = useConnection();

  const key = useMemo(() => {
    if (tab === "wishlist") return null;
    const p = new URLSearchParams({ sort, scope: tab });
    if (rarity.length) p.set("rarity", rarity.join(","));
    if (query.trim()) p.set("q", query.trim());
    return `/market?${p}`;
  }, [tab, sort, rarity, query]);
  const { data, error, mutate } = useSWR<AuctionDTO[]>(key, { refreshInterval: 30_000 });

  // S'abonne en direct aux ventes affichées.
  const ids = useMemo(() => (data ?? []).map((a) => a.id).join(","), [data]);
  useEffect(() => {
    if (!socket || !ids) return;
    const list = ids.split(",").map(Number);
    list.forEach((id) => socket.emit("auction:watch", id));
    return () => list.forEach((id) => socket.emit("auction:unwatch", id));
  }, [socket, ids, connection]);

  useSocketEvent("auction:update", (u) => {
    if (u.status !== "open") {
      void mutate();
      return;
    }
    void mutate(
      (list) =>
        list?.map((a) =>
          a.id === u.id
            ? {
                ...a,
                currentBid: u.currentBid,
                currentBidder: u.currentBidder,
                currentBidderId: u.currentBidderId,
                bidCount: u.bidCount,
                endsAt: u.endsAt,
                minBid: minNextBid(a.startPrice, u.currentBid),
              }
            : a,
        ),
      { revalidate: false },
    );
    setChanged((s) => new Set(s).add(u.id));
  });

  const visible = (data ?? []).filter((a) => new Date(a.endsAt).getTime() > now - 5_000 || a.status !== "open");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title">Marché</h1>
        <p className="hatnote mt-2">
          Enchères en direct. Une offre dans la dernière minute prolonge la vente de 60 secondes. Les points de ton
          offre sont bloqués et te sont rendus si quelqu’un surenchérit.
        </p>
      </div>

      <nav aria-label="Onglets du marché" className="-mb-2 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-current={tab === t.value ? "page" : undefined}
            onClick={() => router.replace(t.value === "all" ? "/market" : `/market?scope=${t.value}`)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors duration-150 ${
              tab === t.value ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "wishlist" ? (
        <Wishlist />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-44 flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chercher une carte en vente"
                aria-label="Chercher une carte en vente"
                className="field h-9 min-h-0 pl-8 text-sm"
              />
            </div>
            <RarityFilter value={rarity} onChange={setRarity} />
            <Select label="Trier" value={sort} onChange={setSort} options={SORTS} />
          </div>

          {error ? (
            <ErrorBox error={error} retry={() => mutate()} />
          ) : !data ? (
            <div className="h-72 animate-pulse rounded-md bg-panel" aria-busy />
          ) : visible.length === 0 ? (
            <Empty
              title={
                tab === "mine"
                  ? "Tu n’as rien en vente"
                  : tab === "bidding"
                    ? "Aucune enchère en cours"
                    : "Aucune vente en cours"
              }
            >
              {tab === "mine" ? (
                <>
                  Choisis une carte dans ta{" "}
                  <Link href="/collection" className="article-link">
                    collection
                  </Link>{" "}
                  puis « Vendre » sur sa fiche.
                </>
              ) : (
                "Reviens plus tard, ou mets une carte en vente depuis sa fiche."
              )}
            </Empty>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line bg-panel">
              {visible.map((a) => (
                <AuctionRow
                  key={a.id}
                  auction={a}
                  now={now}
                  changed={changed.has(a.id)}
                  onSeen={() =>
                    setChanged((s) => {
                      const next = new Set(s);
                      next.delete(a.id);
                      return next;
                    })
                  }
                  onChanged={() => mutate()}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default function MarketPage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-md bg-panel" />}>
      <Market />
    </Suspense>
  );
}
