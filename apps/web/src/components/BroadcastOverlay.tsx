"use client";

import type { BroadcastDTO } from "@palacards/shared";
import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { BROADCAST_TONE as TONE } from "@/lib/broadcasts";
import { useConnection, useMe, useSocketEvent } from "@/lib/game";
import { play } from "@/lib/sfx";
import "./content.css";

/**
 * Messages serveur de l'admin, posés par-dessus la page : ceux envoyés pendant que le joueur est là
 * arrivent en direct (socket), les autres l'attendent à sa prochaine visite. Un message fermé ne revient
 * plus, sur aucun appareil. Plusieurs messages se suivent, du plus ancien au plus récent.
 */
export function BroadcastOverlay() {
  const { me } = useMe();
  const connection = useConnection();
  const router = useRouter();
  const [queue, setQueue] = useState<BroadcastDTO[]>([]);
  // Messages déjà fermés dans la série en cours : le compteur avance (1 / 10, 2 / 10…) à total fixe.
  const [done, setDone] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  const current = queue[0] ?? null;
  const loggedIn = !!me;
  const total = done + queue.length;

  const add = (list: BroadcastDTO[]) => setQueue((q) => [...q, ...list.filter((m) => !q.some((x) => x.id === m.id))]);

  // À l'arrivée et après chaque reconnexion : les messages envoyés pendant l'absence.
  useEffect(() => {
    if (!loggedIn) return;
    void api<BroadcastDTO[]>("/broadcasts/pending")
      .then(add)
      .catch(() => {});
  }, [loggedIn, connection]);

  useSocketEvent("broadcast:new", (m) => {
    add([m]);
    play("achievement");
  });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (current && !d.open) {
      d.showModal();
      // Le bouton principal prend le focus (Entrée ferme le message), pas le lien.
      d.querySelector<HTMLButtonElement>("[data-primary]")?.focus();
    }
    if (!current && d.open) d.close();
  }, [current]);

  function dismiss() {
    if (!current) return;
    void api(`/broadcasts/${current.id}/read`, { method: "POST" }).catch(() => {});
    setDone(queue.length > 1 ? done + 1 : 0);
    setQueue((q) => q.slice(1));
  }

  /** « Tout passer » : ferme la série d'un coup ; chaque message reste relisible dans « Mises à jour ». */
  function dismissAll() {
    if (!queue.length) return;
    void api("/broadcasts/read", { body: { ids: queue.map((m) => m.id) } }).catch(() => {});
    setDone(0);
    setQueue([]);
  }

  const tone = current ? TONE[current.tone] : TONE.info;
  const Icon = tone.icon;
  const internal = !!current?.linkUrl?.startsWith("/");

  return (
    <dialog
      ref={ref}
      className="pc-broadcast"
      data-tone={current?.tone ?? "info"}
      aria-labelledby="broadcast-title"
      onCancel={(e) => {
        // Échap ferme le message comme le bouton : il compte comme lu.
        e.preventDefault();
        dismiss();
      }}
    >
      {current && (
        <div className="pc-broadcast-card" key={current.id}>
          <div className="pc-broadcast-band cover-texture flex items-start gap-3">
            <Icon className="mt-1 size-6 shrink-0" aria-hidden />
            <h2
              id="broadcast-title"
              aria-label={`${tone.label} : ${current.title}`}
              className="flex-1 font-display text-[1.9rem] uppercase leading-[0.95] [text-wrap:balance]"
            >
              {current.title}
            </h2>
            {total > 1 && (
              <span className="tnum mt-1.5 shrink-0 text-sm font-semibold text-white/75">
                {done + 1} / {total}
              </span>
            )}
          </div>
          <div className="px-5 pb-5 pt-4">
            <p className="pc-broadcast-body max-h-[50dvh] overflow-y-auto leading-relaxed text-text">{current.body}</p>
            {current.sentAt && (
              <p className="mt-3 text-xs text-faint">
                {new Date(current.sentAt).toLocaleString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t-2 border-dashed border-line pt-4">
              {queue.length > 1 && (
                <button type="button" className="btn btn-ghost mr-auto text-muted" onClick={dismissAll}>
                  Tout passer ({queue.length})
                </button>
              )}
              {current.linkUrl &&
                (internal ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const href = current.linkUrl!;
                      dismiss();
                      router.push(href);
                    }}
                  >
                    {current.linkLabel || "Voir"}
                  </button>
                ) : (
                  <a className="btn" href={current.linkUrl} target="_blank" rel="noreferrer" onClick={dismiss}>
                    {current.linkLabel || "Ouvrir le lien"}
                    <ExternalLink className="size-4" aria-hidden />
                  </a>
                ))}
              <button type="button" className="btn btn-primary" onClick={dismiss} data-primary>
                {queue.length > 1 ? "Suivant" : "J'ai compris"}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
