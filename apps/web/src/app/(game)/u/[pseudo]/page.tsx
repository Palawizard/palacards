"use client";

import type { CardDTO, Page } from "@palacards/shared";
import { MessageSquare, Repeat, Swords, UserCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { Avatar } from "@/components/Avatar";
import { Card, CardGrid } from "@/components/Card";
import {
  CollectionFilterBar,
  useCollectionFilters,
  type CollectionFilterOptions,
} from "@/components/CollectionFilters";
import { MyShowcase } from "@/components/Showcase";
import { CardSkeletons, Empty, ErrorBox, LoadMore } from "@/components/ui";
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

/** Collection d'un autre joueur, avec les filtres de la sienne (sauf favoris et tags, privés). */
function TheirCollection({ username }: { username: string }) {
  const source = `/players/${encodeURIComponent(username)}/collection`;
  const { value: f, set, q, params } = useCollectionFilters();
  const summary = useSWR<CollectionFilterOptions>(`${source}/summary`);
  const query = `${params}${params ? "&" : ""}sort=${f.sort}&limit=60`;
  const list = useSWRInfinite<Page<CardDTO>>((i, prev) =>
    prev && !prev.nextCursor ? null : `${source}?${query}&page=${i}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const total = list.data?.[0]?.total ?? 0;
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((s) => s + 1);
  }, [list]);

  return (
    <div className="flex flex-col gap-4">
      <CollectionFilterBar
        value={f}
        onChange={set}
        options={summary.data}
        owner={false}
        className="rounded-xl border border-line bg-panel p-3"
      />
      <p className="tnum text-sm text-muted" aria-live="polite">
        {list.data ? `${fmt(total)} carte${total > 1 ? "s" : ""}` : "\u00a0"}
      </p>
      {list.error ? (
        <ErrorBox error={list.error} retry={() => list.mutate()} />
      ) : !list.data ? (
        <CardSkeletons count={6} />
      ) : items.length === 0 ? (
        params ? (
          <Empty title="Aucune carte ne correspond">
            {f.inSummary || !q ? (
              "Change les filtres pour voir d'autres cartes."
            ) : (
              <>
                Aucun titre ne contient « {q} ».{" "}
                <button type="button" className="article-link" onClick={() => set({ inSummary: true })}>
                  Chercher aussi dans les résumés
                </button>
              </>
            )}
          </Empty>
        ) : (
          <p className="text-sm text-muted">Collection vide pour l’instant.</p>
        )
      ) : (
        <>
          <CardGrid dense>
            {items.map((c) => (
              <Card key={c.instanceId} card={c} />
            ))}
          </CardGrid>
          <LoadMore onVisible={loadMore} loading={list.isValidating} done={done} />
        </>
      )}
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

      {p.isMe ? (
        <MyShowcase cards={p.showcase} onChanged={() => mutate()} />
      ) : (
        <section>
          <h2 className="section-title mt-0">Vitrine</h2>
          {p.showcase.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
              {p.showcase.map((c) => (
                <Card key={c.instanceId} card={c} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Aucune carte épinglée pour l’instant.</p>
          )}
        </section>
      )}

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
