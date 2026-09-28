"use client";

import type { CardDTO, Page } from "@palacards/shared";
import { ArrowLeft, MessageSquare, Paperclip, SendHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Avatar } from "@/components/Avatar";
import { Card, RaritySigil } from "@/components/Card";
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
  /** Avatar du joueur (MP) ou emblème de la guilde. */
  avatar: string | null;
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
  senderUsername: string | null;
  senderAvatar: string | null;
  body: string;
  card: {
    cardId: number;
    season: number;
    title: string;
    rarity: CardDTO["rarity"];
    atk: number;
    def: number;
    thumbUrl: string | null;
  } | null;
  createdAt: string;
}

/** Deux messages du même auteur à moins de 5 minutes d'écart forment un groupe de bulles. */
const GROUP_GAP_MS = 5 * 60_000;

const hour = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Aujourd’hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Carte partagée : une vraie vignette, cliquable vers sa fiche. */
function sharedCard(c: NonNullable<Message["card"]>): CardDTO {
  return { ...c, instanceId: null, level: 1, pageUrl: null };
}

/** Pastille d'une conversation : avatar du joueur, ou emblème de la guilde dans un écusson. */
function ChannelBadge({ c, size = "md" }: { c: Conversation; size?: "md" | "lg" }) {
  if (c.kind === "dm") return <Avatar name={c.title} avatar={c.avatar} online={c.online} />;
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-xl bg-cover text-cover-ink shadow-[inset_0_-2px_0_var(--color-cover-2)] ${
        size === "lg" ? "size-11 text-2xl" : "size-10 text-xl"
      }`}
    >
      {c.avatar ?? <MessageSquare className="size-4" />}
    </span>
  );
}

function CardPicker({ onPick, onClose }: { onPick: (c: CardDTO) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { data } = useSWR<Page<CardDTO>>(
    `/collection?limit=30&sort=rarity${q.trim().length >= 2 ? `&q=${encodeURIComponent(q.trim())}` : ""}`,
  );
  return (
    <div className="pc-popover absolute bottom-full left-0 z-20 mb-2 w-[min(22rem,100%)] rounded-xl border border-line-strong bg-panel p-2 shadow-pop">
      <div className="mb-2 flex gap-2">
        <input
          className="field h-8 min-h-0 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
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
              className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition-colors duration-150 hover:bg-panel-2"
              onClick={() => onPick(c)}
            >
              <Thumb card={c} size="sm" />
              <span className="line-clamp-1 flex-1 font-display">{c.title}</span>
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
  conversation,
  onSent,
  onRead,
}: {
  channel: string | null;
  to: string | null;
  conversation: Conversation | undefined;
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
  const atBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  // Messages déjà là à l'ouverture : seuls ceux qui arrivent ensuite s'animent.
  const [initial, setInitial] = useState<Set<number> | null>(null);
  if (data && !initial) setInitial(new Set(data.items.map((m) => m.id)));
  const guild = conversation?.kind === "guild";
  const title = conversation?.title ?? to ?? "";

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
    atBottom.current = false;
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
      input.current?.focus();
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
    <div className="infobox flex h-[calc(100dvh-7rem)] min-h-[24rem] flex-col overflow-hidden lg:h-[calc(100dvh-12rem)]">
      <header className="flex items-center gap-3 border-b-2 border-dashed border-line px-3 py-2.5 sm:px-4">
        <Link href="/messages" className="btn btn-sm btn-ghost -ml-1 px-1.5 lg:hidden" aria-label="Conversations">
          <ArrowLeft className="size-4" />
        </Link>
        {conversation ? <ChannelBadge c={conversation} size="lg" /> : <Avatar name={title} avatar={null} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl uppercase leading-tight">{title}</h2>
          <p className="text-xs text-muted">
            {guild ? (
              "Salon de la guilde"
            ) : conversation?.online ? (
              <span className="text-highlight">En ligne</span>
            ) : (
              "Hors ligne"
            )}
          </p>
        </div>
        {guild ? (
          <Link href="/guild" className="btn btn-sm btn-ghost">
            Guilde
          </Link>
        ) : (
          (conversation?.username ?? to) && (
            <Link href={`/u/${conversation?.username ?? to}`} className="btn btn-sm btn-ghost">
              Profil
            </Link>
          )
        )}
      </header>

      <div
        className="pc-chat min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {moreCursor && (
          <div className="mb-4 flex justify-center">
            <button type="button" className="btn btn-sm btn-ghost" onClick={loadOlder}>
              Messages plus anciens
            </button>
          </div>
        )}
        {error ? (
          <ErrorBox error={error} retry={() => mutate()} />
        ) : channel && !data ? (
          <div className="flex flex-col gap-3" aria-hidden>
            {[40, 62, 30].map((w, i) => (
              <div
                key={i}
                className={`h-9 animate-pulse rounded-2xl bg-panel-2 ${i === 1 ? "self-end" : ""}`}
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        ) : !items.length ? (
          <div className="grid h-full place-items-center">
            <p className="max-w-xs text-center text-sm text-muted">
              {guild
                ? "Le salon est vide. Lance la discussion avec ta guilde."
                : `Dis bonjour à ${title}, ou partage-lui une carte avec le trombone.`}
            </p>
          </div>
        ) : (
          <ol className="flex flex-col">
            {items.map((msg, i) => {
              const prev = items[i - 1];
              const next = items[i + 1];
              const mine = msg.senderId === me?.id;
              const newDay = !prev || dayKey(prev.createdAt) !== dayKey(msg.createdAt);
              const joined = (a: Message | undefined, b: Message | undefined) =>
                !!a &&
                !!b &&
                a.senderId === b.senderId &&
                dayKey(a.createdAt) === dayKey(b.createdAt) &&
                Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < GROUP_GAP_MS;
              const first = !joined(prev, msg);
              const last = !joined(msg, next);
              const fresh = !!initial && !initial.has(msg.id);
              return (
                <li key={msg.id} className={first && !newDay ? "mt-3" : "mt-0.5"}>
                  {newDay && (
                    <p className="pc-day my-4 first:mt-0">
                      <span>{dayLabel(msg.createdAt)}</span>
                    </p>
                  )}
                  <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                    {guild && !mine && (
                      <span className="w-8 shrink-0">
                        {last && <Avatar name={msg.sender} avatar={msg.senderAvatar} size="sm" />}
                      </span>
                    )}
                    <div
                      className={`flex min-w-0 max-w-[min(80%,34rem)] flex-col ${mine ? "items-end" : "items-start"} ${
                        fresh ? "pc-bubble-in" : ""
                      }`}
                    >
                      {guild && !mine && first && (
                        <Link
                          href={msg.senderUsername ? `/u/${msg.senderUsername}` : "#"}
                          className="mb-0.5 ml-3 text-xs font-semibold text-muted hover:text-text"
                        >
                          {msg.sender}
                        </Link>
                      )}
                      {msg.body && (
                        <p
                          className="pc-bubble"
                          data-mine={mine || undefined}
                          data-first={first || undefined}
                          data-last={last || undefined}
                        >
                          {msg.body}
                        </p>
                      )}
                      {msg.card && (
                        <div className={`w-[8.5rem] ${msg.body ? "mt-1" : ""}`}>
                          <Card card={sharedCard(msg.card)} prefetch={false} />
                        </div>
                      )}
                      {last && (
                        <time dateTime={msg.createdAt} className="tnum mx-3 mt-1 text-[0.7rem] text-faint">
                          {hour(msg.createdAt)}
                        </time>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={end} />
      </div>

      <form onSubmit={send} className="relative border-t border-line bg-panel px-3 py-2.5 sm:px-4">
        {picking && (
          <CardPicker
            onPick={(c) => {
              setCard(c);
              setPicking(false);
              input.current?.focus();
            }}
            onClose={() => setPicking(false)}
          />
        )}
        {card && (
          <span className="chip mb-2 w-fit max-w-full gap-2">
            <RaritySigil rarity={card.rarity} /> <span className="truncate">{card.title}</span>
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
        <div className="pc-composer flex items-end gap-1 rounded-2xl border border-line-strong bg-bg p-1">
          <button
            type="button"
            className="btn btn-sm btn-ghost size-9 shrink-0 rounded-xl px-0"
            onClick={() => setPicking((v) => !v)}
            aria-label="Partager une carte"
            aria-expanded={picking}
            title="Partager une carte"
          >
            <Paperclip className="size-4" />
          </button>
          <textarea
            ref={input}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-[0.45rem] text-[15px] leading-snug outline-none [field-sizing:content] placeholder:text-faint"
            rows={1}
            value={body}
            maxLength={1000}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) void send(e);
            }}
            placeholder={guild ? "Écrire à la guilde" : `Écrire à ${title}`}
            aria-label="Message"
          />
          <button
            type="submit"
            className="btn btn-primary size-9 shrink-0 rounded-xl px-0"
            disabled={busy || (!body.trim() && !card)}
            aria-label="Envoyer"
          >
            <SendHorizontal className="size-4" />
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
      <h1 className={`page-title ${open ? "hidden lg:block" : ""}`}>Messages</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-6">
        <aside className={open ? "hidden lg:block" : ""}>
          {error ? (
            <ErrorBox error={error} retry={() => mutate()} />
          ) : !data ? (
            <div className="h-60 animate-pulse rounded-xl bg-panel" />
          ) : data.length === 0 ? (
            <Empty title="Aucune conversation">
              Écris à un ami depuis la page{" "}
              <Link href="/friends" className="article-link">
                Amis
              </Link>
              .
            </Empty>
          ) : (
            <ul className="infobox flex flex-col gap-0.5 p-1.5">
              {data.map((c) => (
                <li key={c.channel}>
                  <Link
                    href={`/messages?channel=${encodeURIComponent(c.channel)}`}
                    aria-current={c.channel === current?.channel ? "page" : undefined}
                    className="pc-convo flex items-center gap-3 rounded-[10px] px-2.5 py-2"
                  >
                    <ChannelBadge c={c} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate ${c.unread ? "font-bold text-text" : "font-semibold"}`}>
                          {c.title}
                        </span>
                        {c.lastAt && <span className="shrink-0 text-xs text-faint">{relative(c.lastAt)}</span>}
                      </span>
                      <span className="flex items-center justify-between gap-2 text-sm">
                        <span className={`truncate ${c.unread ? "text-text" : "text-muted"}`}>
                          {c.lastBody
                            ? `${c.lastFromMe ? "Toi : " : ""}${c.lastBody}`
                            : c.kind === "guild"
                              ? "Salon de la guilde"
                              : "Carte partagée"}
                        </span>
                        {c.unread > 0 && (
                          <span className="tnum min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-bold text-accent-ink">
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
            <Thread
              key={current?.channel ?? to ?? ""}
              channel={current?.channel ?? (channel || null)}
              to={to}
              conversation={current}
              onRead={onRead}
              onSent={(ch) => {
                void mutate();
                router.replace(`/messages?channel=${encodeURIComponent(ch)}`);
              }}
            />
          ) : (
            <div className="slot grid h-[calc(100dvh-12rem)] min-h-[26rem] place-items-center px-6 text-center">
              <div>
                <p className="font-display text-2xl uppercase">Choisis une conversation</p>
                <p className="mt-1 text-sm text-muted">Tes messages privés et le salon de ta guilde sont à gauche.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="h-60 animate-pulse rounded-xl bg-panel" />}>
      <Messages />
    </Suspense>
  );
}
