"use client";

import { RARITY_LABELS, SHOP_PRICES, SHOP_RARITIES, type ShopRarity } from "@palacards/game";
import type { ShopBuyDTO, ShopDTO } from "@palacards/shared";
import { Check, Clock, Coins } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Card, CardGrid } from "@/components/Card";
import { CardSkeletons, ConfirmDialog, Empty, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSeenFeature } from "@/lib/features";
import { countdown, fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";

const NBSP = String.fromCharCode(160);
type Item = ShopDTO["items"][number];

/**
 * Boutique du jour : 20 cartes de la saison choisies pour le joueur (les cartes qu'il n'a pas d'abord),
 * renouvelées à minuit (heure de Paris). Prix fixe par rareté, chaque carte s'achète une fois ; confirmation
 * pour une légendaire. La brillance se tire à l'achat : une carte achetée brillante le reste à l'affichage.
 */
export default function ShopPage() {
  useSeenFeature("shop");
  const { me, mutateMe } = useMe();
  const { data, error, mutate } = useSWR<ShopDTO>("/shop");
  const now = useNow(1000);
  const [filter, setFilter] = useState<ShopRarity | null>(null);
  const [buying, setBuying] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Item | null>(null);
  const balance = me?.wallet.available ?? 0;
  // Minuit passé pendant la visite : la nouvelle boutique se charge d'elle-même.
  const left = data ? new Date(data.resetsAt).getTime() - now : 0;
  const expired = !!data && left <= 0;
  useEffect(() => {
    if (expired) void mutate();
  }, [expired, mutate]);

  async function buy(item: Item) {
    if (buying !== null) return;
    setBuying(item.slot);
    try {
      const res = await api<ShopBuyDTO>("/shop/buy", {
        body: { slot: item.slot },
      });
      if (res.shiny) {
        play("shiny");
        toast.success(`Brillante${NBSP}! ${item.card.title} rejoint ta collection en version brillante.`);
      } else {
        play("coin");
        toast.success(`${item.card.title} rejoint ta collection.`);
      }
      void mutateMe((m) => (m ? { ...m, wallet: res.wallet } : m), { revalidate: false });
      void mutate(
        (d) =>
          d
            ? {
                ...d,
                items: d.items.map((i) =>
                  i.slot === item.slot ? { ...i, purchased: true, card: { ...i.card, shiny: res.shiny } } : i,
                ),
              }
            : d,
        { revalidate: true },
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Achat impossible.");
      void mutate();
    } finally {
      setBuying(null);
    }
  }

  const items = data?.items.filter((i) => !filter || i.card.rarity === filter) ?? [];
  const counts = Object.fromEntries(
    SHOP_RARITIES.map((r) => [r, data?.items.filter((i) => i.card.rarity === r).length ?? 0]),
  ) as Record<ShopRarity, number>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title">Boutique du jour</h1>
        <p className="hatnote mt-2">
          Chaque jour, une sélection rien que pour toi : 20 cartes de la saison, en priorité celles qui te manquent.
          Prix fixes ({fmt(SHOP_PRICES.SR)}
          {NBSP}PW la super rare, {fmt(SHOP_PRICES.UR)}
          {NBSP}PW l’ultra rare, {fmt(SHOP_PRICES.L)}
          {NBSP}PW la légendaire), chaque carte s’achète une fois. Comme dans un paquet, une carte achetée a une petite
          chance d’arriver brillante.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par rareté">
          <button type="button" className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
            Toutes
          </button>
          {SHOP_RARITIES.map((r) => (
            <button
              key={r}
              type="button"
              className="chip tnum"
              aria-pressed={filter === r}
              disabled={!counts[r]}
              onClick={() => setFilter(filter === r ? null : r)}
            >
              {RARITY_LABELS[r]} ({counts[r]})
            </button>
          ))}
        </div>
        <div className="tnum flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Coins aria-hidden className="size-4" />
            Solde{NBSP}: <strong className="text-text">{fmt(balance)}</strong>
            {NBSP}PW
          </span>
          {data && (
            <span className="inline-flex items-center gap-1.5" aria-live="off">
              <Clock aria-hidden className="size-4" />
              Nouvelle sélection dans <strong className="text-text">{countdown(Math.max(0, left))}</strong>
            </span>
          )}
        </div>
      </div>

      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !data ? (
        <CardSkeletons count={10} />
      ) : data.items.length === 0 ? (
        <Empty title="La boutique est vide aujourd’hui">Reviens demain pour une nouvelle sélection.</Empty>
      ) : (
        <CardGrid>
          {items.map((item) => {
            const short = balance < item.price;
            const busy = buying === item.slot;
            return (
              <div key={item.slot} className="flex flex-col gap-1.5">
                <div className={`transition-opacity duration-200 ${item.purchased ? "opacity-60" : ""}`}>
                  <Card card={item.card} />
                </div>
                <p className="tnum text-xs font-bold text-text">
                  {fmt(item.price)}
                  {NBSP}PW
                </p>
                {item.purchased ? (
                  <p className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-panel-2 text-sm font-semibold text-good">
                    <Check aria-hidden className="size-4" strokeWidth={3} />
                    Achetée
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm w-full"
                    disabled={short || buying !== null}
                    aria-label={`Acheter ${item.card.title} pour ${fmt(item.price)} PW`}
                    title={short ? "Pas assez de points wiki" : undefined}
                    onClick={() => (item.card.rarity === "L" ? setConfirm(item) : void buy(item))}
                  >
                    {busy ? "Achat…" : short ? "PW insuffisants" : "Acheter"}
                  </button>
                )}
              </div>
            );
          })}
        </CardGrid>
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Acheter cette légendaire ?"
        confirmLabel={confirm ? `Acheter pour ${fmt(confirm.price)} PW` : "Acheter"}
        onConfirm={() => confirm && void buy(confirm)}
        onClose={() => setConfirm(null)}
      >
        {confirm && (
          <p>
            <strong className="text-text">{confirm.card.title}</strong> rejoint ta collection contre{" "}
            {fmt(confirm.price)}
            {NBSP}PW. Il te restera {fmt(balance - confirm.price)}
            {NBSP}PW.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
