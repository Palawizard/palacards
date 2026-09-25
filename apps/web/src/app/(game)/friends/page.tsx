"use client";

import { MessageSquare, Repeat, Swords, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Avatar } from "@/components/Avatar";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useSocketEvent } from "@/lib/game";

interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  elo: number;
  online: boolean;
}
interface FriendsDTO {
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
}

export default function FriendsPage() {
  const { data, error, mutate } = useSWR<FriendsDTO>("/friends");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useSocketEvent("presence:update", ({ userId, online }) => {
    void mutate((d) => d && { ...d, friends: d.friends.map((f) => (f.id === userId ? { ...f, online } : f)) }, {
      revalidate: false,
    });
  });
  useSocketEvent("notification:new", (n) => {
    if (n.type.startsWith("friend_")) void mutate();
  });

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      void mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  const online = data?.friends.filter((f) => f.online).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Amis</h1>
        <p className="hatnote mt-2 tnum">
          {data
            ? `${data.friends.length} ami${data.friends.length > 1 ? "s" : ""}, ${online} en ligne.`
            : "Chargement…"}
        </p>
      </div>

      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(async () => {
            const r = await api<{ status: string }>("/friends", { body: { username: name.trim() } });
            toast.success(r.status === "accepted" ? "Vous êtes maintenant amis !" : "Demande envoyée.");
            setName("");
          });
        }}
      >
        <label className="sr-only" htmlFor="friend-name">
          Pseudo à ajouter
        </label>
        <input
          id="friend-name"
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Pseudo d’un joueur"
          autoCapitalize="none"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          <UserPlus aria-hidden className="size-4" /> Ajouter
        </button>
      </form>

      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="h-60 animate-pulse rounded-xl bg-panel" aria-busy />
      ) : (
        <>
          {data.incoming.length > 0 && (
            <section>
              <h2 className="section-title mt-0">Demandes reçues</h2>
              <ul className="flex flex-col gap-2">
                {data.incoming.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2">
                    <Avatar name={f.displayName} avatar={f.avatar} />
                    <Link href={`/u/${f.username}`} className="flex-1 font-semibold hover:underline">
                      {f.displayName}
                    </Link>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={busy}
                      onClick={() => run(() => api(`/friends/${f.id}`, { method: "DELETE" }))}
                    >
                      Refuser
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() => run(() => api(`/friends/${f.id}/accept`, { method: "POST" }), "Nouvel ami !")}
                    >
                      Accepter
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="section-title mt-0">Mes amis</h2>
            {data.friends.length === 0 ? (
              <Empty title="Pas encore d’amis ici">
                Ajoute tes potes par leur pseudo pour échanger, discuter et vous défier.
              </Empty>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {[...data.friends]
                  .sort((a, b) => Number(b.online) - Number(a.online))
                  .map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5"
                    >
                      <Avatar name={f.displayName} avatar={f.avatar} online={f.online} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/u/${f.username}`} className="block truncate font-semibold hover:underline">
                          {f.displayName}
                        </Link>
                        <span className="tnum text-xs text-faint">
                          {f.online ? "en ligne" : "hors ligne"} · Elo {fmt(f.elo)}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <Link
                          href={`/messages?to=${f.username}`}
                          className="btn btn-sm btn-ghost px-2"
                          aria-label={`Écrire à ${f.displayName}`}
                          title="Message"
                        >
                          <MessageSquare className="size-4" />
                        </Link>
                        <Link
                          href={`/trades/new?to=${f.username}`}
                          className="btn btn-sm btn-ghost px-2"
                          aria-label={`Échanger avec ${f.displayName}`}
                          title="Échanger"
                        >
                          <Repeat className="size-4" />
                        </Link>
                        <Link
                          href={`/battle?opponent=${f.username}`}
                          className="btn btn-sm btn-ghost px-2"
                          aria-label={`Défier ${f.displayName}`}
                          title="Défier"
                        >
                          <Swords className="size-4" />
                        </Link>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          {data.outgoing.length > 0 && (
            <section>
              <h2 className="section-title mt-0">Demandes envoyées</h2>
              <ul className="flex flex-wrap gap-2">
                {data.outgoing.map((f) => (
                  <li key={f.id} className="chip gap-2 pr-1">
                    {f.displayName}
                    <button
                      type="button"
                      className="rounded-full px-1.5 text-faint hover:text-danger"
                      disabled={busy}
                      onClick={() => run(() => api(`/friends/${f.id}`, { method: "DELETE" }))}
                      aria-label={`Annuler la demande à ${f.displayName}`}
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
