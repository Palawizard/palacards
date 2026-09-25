"use client";

import type { CardDTO, Page } from "@palacards/shared";
import { MessageSquare, Repeat, Swords, UserCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Avatar } from "@/components/Avatar";
import { Card, CardGrid } from "@/components/Card";
import { CardSkeletons, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";

interface ProfileDTO {
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
  relation: "self" | "friends" | "incoming" | "outgoing" | "none";
  online: boolean;
  guild: { id: number; name: string; tag: string; emblem: string; role: string } | null;
}

const since = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

function Actions({ p, onChanged }: { p: ProfileDTO; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }
  if (p.isMe) {
    return (
      <Link href="/settings" className="btn btn-sm">
        Modifier mon profil
      </Link>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/battle?opponent=${p.username}`} className="btn btn-sm btn-primary">
        <Swords aria-hidden className="size-4" /> Défier
      </Link>
      <Link href={`/trades/new?to=${p.username}`} className="btn btn-sm">
        <Repeat aria-hidden className="size-4" /> Échanger
      </Link>
      <Link href={`/messages?to=${p.username}`} className="btn btn-sm">
        <MessageSquare aria-hidden className="size-4" /> Message
      </Link>
      {p.relation === "none" && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => run(() => api("/friends", { body: { username: p.username } }), "Demande d'ami envoyée.")}
        >
          <UserPlus aria-hidden className="size-4" /> Ajouter en ami
        </button>
      )}
      {p.relation === "incoming" && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => run(() => api(`/friends/${p.id}/accept`, { method: "POST" }), "Vous êtes amis !")}
        >
          <UserCheck aria-hidden className="size-4" /> Accepter sa demande
        </button>
      )}
      {p.relation === "outgoing" && <span className="chip">Demande envoyée</span>}
      {p.relation === "friends" && (
        <span className="chip">
          <UserCheck aria-hidden className="size-3.5" /> Ami
        </span>
      )}
    </div>
  );
}

function TheirCollection({ username }: { username: string }) {
  const [page, setPage] = useState(0);
  const { data, error } = useSWR<Page<CardDTO>>(`/players/${encodeURIComponent(username)}/collection?page=${page}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <CardSkeletons count={6} />;
  if (!data.items.length) return <p className="text-sm text-muted">Collection vide pour l’instant.</p>;
  return (
    <div className="flex flex-col gap-4">
      <CardGrid dense>
        {data.items.map((c) => (
          <Card key={c.instanceId} card={c} />
        ))}
      </CardGrid>
      <div className="flex items-center justify-center gap-2 text-sm">
        <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>
          Précédentes
        </button>
        <span className="tnum text-muted">
          page {page + 1} / {Math.max(1, Math.ceil((data.total ?? 0) / 60))}
        </span>
        <button type="button" className="btn btn-sm" disabled={!data.nextCursor} onClick={() => setPage((x) => x + 1)}>
          Suivantes
        </button>
      </div>
    </div>
  );
}

export default function ProfilePage({ params }: { params: Promise<{ pseudo: string }> }) {
  const { pseudo } = use(params);
  const { data: p, error, mutate } = useSWR<ProfileDTO>(`/players/${encodeURIComponent(pseudo)}`);

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!p) return <div className="h-72 animate-pulse rounded-xl bg-panel" aria-busy />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end gap-4 border-b-2 border-dashed border-line pb-4">
        <Avatar name={p.displayName} avatar={p.avatar} online={p.isMe ? undefined : p.online} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[clamp(2rem,1.5rem+1.9vw,2.9rem)] uppercase leading-none">
            {p.displayName}
          </h1>
          <p className="text-sm text-muted">
            Joueur depuis {since(p.createdAt)}
            {p.guild && (
              <>
                {" · "}
                {p.isMe ? (
                  <Link href="/guild" className="article-link">
                    {p.guild.emblem} {p.guild.name} [{p.guild.tag}]
                  </Link>
                ) : (
                  <span>
                    {p.guild.emblem} {p.guild.name} [{p.guild.tag}]
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <Actions p={p} onChanged={() => mutate()} />
      </header>

      <dl
        className="tnum grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4 [&>div]:bg-panel"
        style={{ gap: 1 }}
      >
        {[
          ["Score de collection", fmt(p.collectionScore)],
          ["Articles différents", fmt(p.uniqueCards)],
          ["Cartes", fmt(p.totalCards)],
          ["Elo de bataille", `${fmt(p.elo)}`],
        ].map(([k, v]) => (
          <div key={k} className="px-4 py-3">
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
              ? "Épingle jusqu’à 5 cartes depuis leur fiche (bouton « Épingler ») pour les montrer ici."
              : "Aucune carte épinglée pour l’instant."}
          </p>
        )}
      </section>

      <section>
        <h2 className="section-title mt-0">Collection</h2>
        {p.isMe ? (
          <p className="text-sm text-muted">
            <Link href="/collection" className="article-link">
              Voir ma collection
            </Link>
          </p>
        ) : (
          <TheirCollection username={p.username} />
        )}
      </section>
    </div>
  );
}
