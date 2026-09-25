"use client";

import type { CardDTO, Page } from "@palacards/shared";
import { ArrowLeft, Paperclip, Send, Shield, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Avatar } from "@/components/Avatar";
import { RaritySigil } from "@/components/Card";
import { Thumb } from "@/components/market";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { relative } from "@/lib/format";
import { useMe, useSocketEvent } from "@/lib/game";

interface Conversation {
  channel: string;
  kind: "dm" | "guild";
  title: string;
  username: string | null;
  online: boolean;
  lastBody: string;
  lastAt: string;
  lastFromMe: boolean;
  unread: number;
}
interface Message {
  id: number;
  channel: string;
  senderId: string;
  sender: string;
  body: string;
  card: { cardId: number; season: number; title: string; rarity: CardDTO["rarity"] } | null;
  createdAt: string;
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function CardPicker({ onPick, onClose }: { onPick: (c: CardDTO) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { data } = useSWR<Page<CardDTO>>(
    `/collection?limit=30&sort=rarity${q.trim().length >= 2 ? `&q=${encodeURIComponent(q.trim())}` : ""}`,
  );
  return (
    <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-md border border-line-strong bg-panel p-2 shadow-[0_12px_30px_-10px_rgb(0_0_0/0.8)]">
      <div className="mb-2 flex gap-2">
        <input
          className="field h-8 min-h-0 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher une de tes cartes"
          aria-label="Chercher une de tes cartes"
          autoFocus
        />
        <button type="button" className="btn btn-sm btn-ghost px-2" onClick={onClose} aria-label="Fermer">
          <X className="size-4" />
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto">
        {data?.items.map((c) => (
          <li key={c.instanceId}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded p-1.5 text-left hover:bg-panel-2"
              onClick={() => onPick(c)}
            >
              <Thumb card={c} size="sm" />
              <span className="line-clamp-1 flex-1 font-serif">{c.title}</span>
              <RaritySigil rarity={c.rarity} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thread({
  channel,
  to,
  title,
  onSent,
  onRead,
}: {
  channel: string | null;
  to: string | null;
  title: string;
  onSent: (ch: string) => void;
  onRead: () => void;
}) {
  const { me } = useMe();
  const { data, error, mutate } = useSWR<{ items: Message[]; nextCursor: string | null }>(
    channel ? `/messages/history?channel=${encodeURIComponent(channel)}` : null,
  );
  const [older, setOlder] = useState<{ items: Message[]; cursor: string | null } | null>(null);
  const [body, setBody] = useState("");
  const [card, setCard] = useState<CardDTO | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // Défile en bas seulement si on y était déjà (on ne dérange pas qui relit plus haut).
  useEffect(() => {
    if (atBottom.current) end.current?.scrollIntoView({ block: "end" });
  }, [data]);
  // Marque la conversation comme lue, puis rafraîchit les compteurs (après la réponse du serveur).
  const lastId = data?.items[data.items.length - 1]?.id;
  useEffect(() => {
    if (!channel || lastId === undefined) return;
    void api("/messages/read", { body: { channel } })
      .then(onRead)
      .catch(() => {});
  }, [channel, lastId, onRead]);

  useSocketEvent("message:new", (msg) => {
    if (msg.channel === channel) {
      void mutate((d) => (d && !d.items.some((x) => x.id === msg.id) ? { ...d, items: [...d.items, msg] } : d), {
        revalidate: false,
      });
    }
  });

  async function loadOlder() {
    const cursor = older ? older.cursor : data?.nextCursor;
    if (!channel || !cursor) return;
    const page = await api<{ items: Message[]; nextCursor: string | null }>(
      `/messages/history?channel=${encodeURIComponent(channel)}&before=${cursor}`,
    );
    setOlder((o) => ({ items: [...page.items, ...(o?.items ?? [])], cursor: page.nextCursor }));
  }
  const items = [...(older?.items ?? []), ...(data?.items ?? [])];
  const moreCursor = older ? older.cursor : data?.nextCursor;

  async function send(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy || (!body.trim() && !card)) return;
    setBusy(true);
    atBottom.current = true;
    try {
      const msg = await api<Message>("/messages", {
        body: { ...(channel ? { channel } : { to }), body: body.trim(), instanceId: card?.instanceId ?? undefined },
      });
      setBody("");
      setCard(null);
      if (!channel) onSent(msg.channel);
      else
        void mutate((d) => (d && !d.items.some((x) => x.id === msg.id) ? { ...d, items: [...d.items, msg] } : d), {
          revalidate: false,
        });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60dvh] flex-col">
      <h2 className="border-b border-line pb-1 font-serif text-xl">Discussion : {title}</h2>
      <div
        ref={list}
        className="max-h-[65dvh] flex-1 overflow-y-auto py-3"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {moreCursor && (
          <button type="button" className="btn btn-sm btn-ghost mb-3" onClick={loadOlder}>
            Messages plus anciens
          </button>
        )}
        {error ? (
          <ErrorBox error={error} retry={() => mutate()} />
        ) : channel && !data ? (
          <div className="h-40 animate-pulse rounded bg-panel" />
        ) : !items.length ? (
          <p className="text-sm text-muted">Commence la discussion.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {items.map((msg) => {
              const mine = msg.senderId === me?.id;
              return (
                <li key={msg.id} className={`border-l border-line pl-3 ${mine ? "ml-6 sm:ml-12" : ""}`}>
                  {msg.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.body}</p>}
                  {msg.card && (
                    <Link
                      href={`/card/${msg.card.cardId}`}
                      className="mt-1.5 inline-flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5 hover:border-faint"
                    >
                      <RaritySigil rarity={msg.card.rarity} />
                      <span className="font-serif">{msg.card.title}</span>
                      <span className="text-xs text-faint">S{msg.card.season}</span>
                    </Link>
                  )}
                  <p className="mt-0.5 text-xs text-faint">
                    — <span className={mine ? "" : "font-semibold text-muted"}>{mine ? "toi" : msg.sender}</span>,{" "}
                    {stamp(msg.createdAt)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="relative flex flex-col gap-2 border-t border-line pt-3">
        {picking && (
          <CardPicker
            onPick={(c) => {
              setCard(c);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
        {card && (
          <span className="chip w-fit gap-2">
            <RaritySigil rarity={card.rarity} /> {card.title}
            <button
              type="button"
              onClick={() => setCard(null)}
              aria-label="Retirer la carte"
              className="text-faint hover:text-text"
            >
              <X className="size-3.5" />
            </button>
          </span>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            className="btn btn-ghost px-2"
            onClick={() => setPicking((v) => !v)}
            aria-label="Partager une carte"
            title="Partager une carte"
          >
            <Paperclip className="size-4" />
          </button>
          <textarea
            className="field min-h-10 flex-1 resize-none"
            rows={1}
            value={body}
            maxLength={1000}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) void send(e);
            }}
            placeholder="Écrire un message"
            aria-label="Message"
          />
          <button
            type="submit"
            className="btn btn-primary px-3"
            disabled={busy || (!body.trim() && !card)}
            aria-label="Envoyer"
          >
            <Send className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

function Messages() {
  const router = useRouter();
  const params = useSearchParams();
  const channel = params.get("channel");
  const to = params.get("to");
  const { data, error, mutate } = useSWR<Conversation[]>("/messages");
  const { mutateMe } = useMe();

  useSocketEvent("message:new", () => void mutate());
  const current =
    data?.find((c) => c.channel === channel) ?? (to ? data?.find((c) => c.username === to.toLowerCase()) : undefined);
  useEffect(() => {
    if (current && current.channel !== channel)
      router.replace(`/messages?channel=${encodeURIComponent(current.channel)}`);
  }, [current, channel, router]);
  const onRead = useCallback(() => {
    void mutate();
    void mutateMe();
  }, [mutate, mutateMe]);

  const open = !!channel || !!to;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Messages</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className={open ? "hidden lg:block" : ""}>
          {error ? (
            <ErrorBox error={error} retry={() => mutate()} />
          ) : !data ? (
            <div className="h-60 animate-pulse rounded-md bg-panel" />
          ) : data.length === 0 ? (
            <Empty title="Aucune conversation">
              Écris à un ami depuis la page{" "}
              <Link href="/friends" className="article-link">
                Amis
              </Link>
              .
            </Empty>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line bg-panel">
              {data.map((c) => (
                <li key={c.channel}>
                  <Link
                    href={`/messages?channel=${encodeURIComponent(c.channel)}`}
                    aria-current={c.channel === current?.channel ? "page" : undefined}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-panel-2 aria-[current=page]:bg-panel-2"
                  >
                    {c.kind === "guild" ? (
                      <span
                        className="grid size-10 place-items-center rounded-full border border-line-strong bg-panel-2"
                        aria-hidden
                      >
                        <Shield className="size-4 text-muted" />
                      </span>
                    ) : (
                      <Avatar name={c.title} avatar={null} online={c.online} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate ${c.unread ? "font-bold" : "font-semibold"}`}>{c.title}</span>
                        {c.lastAt && <span className="shrink-0 text-xs text-faint">{relative(c.lastAt)}</span>}
                      </span>
                      <span className="flex items-center justify-between gap-2 text-sm text-muted">
                        <span className="truncate">
                          {c.lastBody
                            ? `${c.lastFromMe ? "Toi : " : ""}${c.lastBody}`
                            : c.kind === "guild"
                              ? "Salon de la guilde"
                              : "Carte partagée"}
                        </span>
                        {c.unread > 0 && (
                          <span className="tnum rounded-full bg-accent px-1.5 text-xs font-bold text-accent-ink">
                            {c.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className={open ? "" : "hidden lg:block"}>
          {open ? (
            <>
              <Link href="/messages" className="btn btn-sm btn-ghost mb-2 lg:hidden">
                <ArrowLeft className="size-4" /> Conversations
              </Link>
              <Thread
                key={current?.channel ?? to ?? ""}
                channel={current?.channel ?? (channel || null)}
                to={to}
                title={current?.title ?? to ?? ""}
                onRead={onRead}
                onSent={(ch) => {
                  void mutate();
                  router.replace(`/messages?channel=${encodeURIComponent(ch)}`);
                }}
              />
            </>
          ) : (
            <p className="pt-8 text-center text-muted">Choisis une conversation.</p>
          )}
        </section>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="h-60 animate-pulse rounded-md bg-panel" />}>
      <Messages />
    </Suspense>
  );
}
