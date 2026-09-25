"use client";

import type { NotificationDTO } from "@palacards/shared";
import Link from "next/link";
import useSWRInfinite from "swr/infinite";
import { Empty, ErrorBox } from "@/components/ui";
import { api } from "@/lib/api";
import { relative } from "@/lib/format";
import { useMe } from "@/lib/game";
import { describe } from "@/lib/notifications";

interface NotifPage {
  items: NotificationDTO[];
  nextCursor: string | null;
  unread: number;
}

export default function NotificationsPage() {
  const { mutateMe } = useMe();
  const list = useSWRInfinite<NotifPage>((i, prev) =>
    prev && !prev.nextCursor ? null : `/notifications${i && prev ? `?before=${prev.nextCursor}` : ""}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const unread = list.data?.[0]?.unread ?? 0;
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;

  async function markRead(ids?: number[]) {
    const res = await api<{ unread: number }>("/notifications/read", { body: ids ? { ids } : {} });
    void mutateMe((m) => (m ? { ...m, unreadNotifications: res.unread } : m), { revalidate: false });
    void list.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="page-title">Notifications</h1>
        {unread > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => markRead()}>
            Tout marquer comme lu
          </button>
        )}
      </div>

      {list.error ? (
        <ErrorBox error={list.error} retry={() => list.mutate()} />
      ) : !list.data ? (
        <div className="h-60 animate-pulse rounded-xl bg-panel" aria-busy />
      ) : items.length === 0 ? (
        <Empty title="Rien de neuf">Les enchères, échanges, défis et succès apparaîtront ici.</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
          {items.map((n) => {
            const { text, href } = describe(n);
            return (
              <li key={n.id}>
                <Link
                  href={href}
                  onClick={() => !n.readAt && markRead([n.id])}
                  className="flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-panel-2"
                >
                  <span
                    aria-label={n.readAt ? undefined : "Non lue"}
                    className={`mt-2 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`}
                  />
                  <span className={`flex-1 ${n.readAt ? "text-muted" : ""}`}>{text}</span>
                  <time dateTime={n.createdAt} className="shrink-0 text-xs text-faint">
                    {relative(n.createdAt)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {!done && list.data && (
        <button
          type="button"
          className="btn btn-sm self-center"
          onClick={() => list.setSize((s) => s + 1)}
          disabled={list.isValidating}
        >
          {list.isValidating ? "Chargement…" : "Plus ancien"}
        </button>
      )}
    </div>
  );
}
