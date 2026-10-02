"use client";

import type { BroadcastDTO } from "@palacards/shared";
import { ExternalLink, Megaphone, Rocket, Siren, Sparkles, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useConnection, useMe, useSocketEvent } from "@/lib/game";
import { play } from "@/lib/sfx";
import "./content.css";

const TONE: Record<BroadcastDTO["tone"], { label: string; icon: LucideIcon }> = {
  info: { label: "Message de l'équipe", icon: Megaphone },
  update: { label: "Mise à jour", icon: Rocket },
  event: { label: "Événement", icon: Sparkles },
  warning: { label: "Important", icon: Siren },
};

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
  const ref = useRef<HTMLDialogElement>(null);
  const current = queue[0] ?? null;
  const loggedIn = !!me;

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
    setQueue((q) => q.slice(1));
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
          <div className="pc-broadcast-band cover-texture">
            <p className="flex items-center gap-2 text-sm font-semibold text-white/85">
              <Icon className="size-4" aria-hidden />
              {tone.label}
              {queue.length > 1 && <span className="tnum ml-auto text-white/70">1 / {queue.length}</span>}
            </p>
            <h2
              id="broadcast-title"
              className="mt-1.5 font-display text-[1.9rem] uppercase leading-[0.95] [text-wrap:balance]"
            >
              {current.title}
            </h2>
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
