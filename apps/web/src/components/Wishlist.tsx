"use client";

import type { CardDTO } from "@palacards/shared";
import Link from "next/link";
import { toast } from "sonner";
import useSWR from "swr";
import { Card, CardGrid } from "@/components/Card";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

/** Cartes suivies par le joueur, avec leur état de mise en vente (page Wishlist). */
export function Wishlist() {
  const { data, error, mutate } = useSWR<(CardDTO & { onSale: number | null })[]>("/wishlist");
  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!data) return <div className="h-60 animate-pulse rounded-xl bg-panel" aria-busy />;
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
              <Link href="/market" className="font-semibold text-good hover:underline">
                En vente
              </Link>
            ) : (
              <span className="text-faint">Pas en vente</span>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost px-2 text-xs"
              aria-label={`Retirer ${c.title} de ma wishlist`}
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
