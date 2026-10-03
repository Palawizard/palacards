"use client";

// Suggestions : bandeau « Une idée ? » et petits éléments partagés par la page joueur et la page admin.
import type { SuggestionDTO, SuggestionKind, SuggestionStatus } from "@palacards/shared";
import { CornerDownRight, Lightbulb, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/game";
import { KINDS, STATUSES } from "@/lib/suggestions";
import "./suggestions.css";

export function KindTag({ kind }: { kind: SuggestionKind }) {
  const k = KINDS[kind];
  const Icon = k.icon;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
      <Icon aria-hidden className="size-3.5" />
      {k.label}
    </span>
  );
}

export function StatusPill({ status, admin = false }: { status: SuggestionStatus; admin?: boolean }) {
  return (
    <span className="pc-status" data-status={status} data-admin={admin || undefined}>
      {admin ? STATUSES[status].admin : STATUSES[status].mine}
    </span>
  );
}

export function Reply({ s }: { s: Pick<SuggestionDTO, "reply" | "repliedAt"> }) {
  if (!s.reply) return null;
  return (
    <div className="pc-reply">
      <p className="pc-reply-by">
        <CornerDownRight aria-hidden className="size-3.5" />
        Réponse de Palawi
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.reply}</p>
    </div>
  );
}

/**
 * Bandeau en haut des pages : « Une idée pour PalaCards ? ». Une fois fermé (ou après un clic sur
 * « Proposer une idée », ou une suggestion envoyée), il ne revient qu'une semaine plus tard, sur tous
 * les appareils. Jamais le premier jour, ni sur les pages Suggestions et Admin.
 */
export function SuggestionBanner() {
  const { me, mutateMe } = useMe();
  const pathname = usePathname();
  const [closing, setClosing] = useState(false);

  const hidden =
    pathname.startsWith("/suggestions") || pathname.startsWith("/admin") || pathname.startsWith("/battle/");
  if (!me?.suggestionBanner || hidden) return null;

  function pause() {
    void api("/suggestions/banner/dismiss", { method: "POST" }).catch(() => {});
  }
  function close() {
    setClosing(true);
    pause();
  }

  return (
    <div
      className="pc-suggest-banner mb-6"
      data-closing={closing || undefined}
      onTransitionEnd={(e) => {
        // Fin du repli : le bandeau disparaît pour de bon (et /me suit, sans requête).
        if (closing && e.propertyName === "grid-template-rows") {
          setClosing(false);
          void mutateMe((m) => (m ? { ...m, suggestionBanner: false } : m), { revalidate: false });
        }
      }}
    >
      <div className="pc-suggest-banner-inner">
        <aside className="pc-suggest-banner-card cover-texture" aria-label="Suggestions">
          <span className="pc-suggest-banner-bulb" aria-hidden>
            <Lightbulb className="size-[1.15rem]" strokeWidth={2.25} />
          </span>
          <p className="min-w-0 flex-1 basis-56 text-[0.93rem] leading-snug">
            <span className="font-semibold">Une idée pour PalaCards ?</span>{" "}
            <span className="text-cover-muted">
              Un bug, un booster qui manque, une règle à revoir : propose-la directement à Palawi.
            </span>
          </p>
          <div className="flex items-center gap-1">
            <Link
              href="/suggestions"
              className="btn btn-sm btn-primary"
              onClick={() => {
                pause();
                void mutateMe((m) => (m ? { ...m, suggestionBanner: false } : m), { revalidate: false });
              }}
            >
              Proposer une idée
            </Link>
            <button
              type="button"
              className="pc-suggest-banner-close"
              onClick={close}
              aria-label="Masquer pendant une semaine"
              title="Masquer pendant une semaine"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
