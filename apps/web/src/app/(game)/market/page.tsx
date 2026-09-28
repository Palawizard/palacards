"use client";

import { minNextBid, type Rarity } from "@palacards/game";
import type { AuctionDTO } from "@palacards/shared";
import { Plus, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AuctionTile, SellDialog } from "@/components/market";
import { CardSkeletons, Empty, ErrorBox, RarityFilter, Select } from "@/components/ui";
import { useConnection, useSocket, useSocketEvent } from "@/lib/game";
import { useNow } from "@/lib/use-now";
import { useDebounced } from "@/lib/use-debounced";

const TABS = [
  { value: "all", label: "Toutes les ventes" },
  { value: "bidding", label: "Mes enchères" },
  { value: "mine", label: "Mes ventes" },
] as const;
type Tab = (typeof TABS)[number]["value"];
const SORTS = [
  { value: "ending", label: "Finissent bientôt" },
  { value: "recent", label: "Plus récentes" },
  { value: "price", label: "Prix" },
] as const;

function Market() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get("scope"))?.value ?? "all") as Tab;
  // L'ancien onglet « Ma wishlist » est devenu une page à part (liens et favoris existants).
  const legacyWishlist = params.get("scope") === "wishlist";
  useEffect(() => {
    if (legacyWishlist) router.replace("/wishlist");
  }, [legacyWishlist, router]);
  const [rarity, setRarity] = useState<Rarity[]>([]);
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("ending");
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [changed, setChanged] = useState<Set<number>>(new Set());
  const [selling, setSelling] = useState(false);
  const now = useNow(1000);
  const socket = useSocket();
  const connection = useConnection();

  const key = useMemo(() => {
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
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="max-w-2xl">
          <h1 className="page-title">Marché</h1>
          <p className="hatnote mt-2">
            Enchères en direct. Une offre dans la dernière minute prolonge la vente de 60 secondes. Les points de ton
            offre sont bloqués et te sont rendus si quelqu’un surenchérit.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setSelling(true)}>
          <Plus aria-hidden className="size-4" /> Mettre en vente
        </button>
      </div>
      <SellDialog
        open={selling}
        onClose={() => setSelling(false)}
        onListed={() => {
          void mutate();
          if (tab !== "all" && tab !== "mine") router.replace("/market?scope=mine");
        }}
      />

      <nav aria-label="Onglets du marché" className="-mb-2 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-current={tab === t.value ? "page" : undefined}
            onClick={() => router.replace(t.value === "all" ? "/market" : `/market?scope=${t.value}`)}
            className={`-mb-px flex-1 border-b-2 px-2 py-2 text-center text-sm leading-tight transition-colors duration-150 sm:flex-none sm:whitespace-nowrap sm:px-3 ${
              tab === t.value ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

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
        <CardSkeletons count={8} />
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
          {tab === "bidding" ? (
            "Tes offres en cours apparaîtront ici."
          ) : (
            <>
              <p>
                {tab === "mine"
                  ? "Choisis une carte de ta collection et fixe ton prix."
                  : "Reviens plus tard, ou lance la première vente."}
              </p>
              <button type="button" className="btn btn-primary btn-sm mt-3" onClick={() => setSelling(true)}>
                <Plus aria-hidden className="size-4" /> Mettre en vente
              </button>
            </>
          )}
        </Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-4 sm:gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
          {visible.map((a) => (
            <AuctionTile
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
    </div>
  );
}

export default function MarketPage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-panel" />}>
      <Market />
    </Suspense>
  );
}
