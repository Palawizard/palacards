"use client";

import type { CardDTO } from "@palacards/shared";
import { use } from "react";
import useSWR from "swr";
import { Card } from "@/components/Card";
import { ErrorBox } from "@/components/ui";
import { fmt } from "@/lib/format";

export interface ProfileDTO {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  createdAt: string;
  elo: number;
  eloPeak: number;
  collectionScore: number;
  uniqueCards: number;
  totalCards: number;
  showcase: CardDTO[];
  isMe: boolean;
}

const since = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

export default function ProfilePage({ params }: { params: Promise<{ pseudo: string }> }) {
  const { pseudo } = use(params);
  const { data: p, error, mutate } = useSWR<ProfileDTO>(`/players/${encodeURIComponent(pseudo)}`);

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!p) return <div className="h-72 animate-pulse rounded-md bg-panel" aria-busy />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end gap-4 border-b border-line-strong pb-3">
        <span
          className="grid size-16 shrink-0 place-items-center rounded-full border border-line-strong bg-panel-2 font-serif text-3xl"
          aria-hidden
        >
          {p.avatar ?? p.displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-serif text-[clamp(1.75rem,1.4rem+1.4vw,2.35rem)] leading-tight">
            {p.displayName}
          </h1>
          <p className="text-sm text-muted">Joueur depuis {since(p.createdAt)}</p>
        </div>
      </header>

      <dl className="tnum grid grid-cols-2 overflow-hidden rounded-md border border-line sm:grid-cols-4">
        {[
          ["Score de collection", fmt(p.collectionScore)],
          ["Articles différents", fmt(p.uniqueCards)],
          ["Cartes", fmt(p.totalCards)],
          ["Elo de bataille", `${fmt(p.elo)}`],
        ].map(([k, v], i) => (
          <div
            key={k}
            className={`bg-panel px-4 py-3 ${i % 2 ? "border-l" : ""} ${i >= 2 ? "border-t sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""} border-line`}
          >
            <dt className="text-xs text-faint">{k}</dt>
            <dd className="text-xl font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h2 className="section-title mt-0">Vitrine</h2>
        {p.showcase.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {p.showcase.map((c) => (
              <Card key={c.instanceId} card={c} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            {p.isMe
              ? "Épingle jusqu’à 5 cartes depuis ta collection pour les montrer ici."
              : "Aucune carte épinglée pour l’instant."}
          </p>
        )}
      </section>
    </div>
  );
}
