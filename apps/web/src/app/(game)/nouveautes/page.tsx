"use client";

import type { BroadcastDTO } from "@palacards/shared";
import { ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { Empty, ErrorBox } from "@/components/ui";
import { BROADCAST_TONE, bodyBlocks } from "@/lib/broadcasts";
import { useSeenFeature } from "@/lib/features";
import "@/components/content.css";

const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", timeZone: "Europe/Paris" });
const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "Europe/Paris" });
const yearFmt = new Intl.DateTimeFormat("fr-FR", { year: "numeric", timeZone: "Europe/Paris" });
const longFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/** Corps du message : paragraphes et listes à puces, tels que Palawi les a tapés. */
function Body({ text }: { text: string }) {
  return (
    <div className="pc-update-body">
      {bodyBlocks(text).map((b, i) =>
        b.kind === "ul" ? (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  );
}

function MessageLink({ m }: { m: BroadcastDTO }) {
  if (!m.linkUrl) return null;
  if (m.linkUrl.startsWith("/"))
    return (
      <Link href={m.linkUrl} className="btn btn-sm">
        {m.linkLabel || "Voir"}
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    );
  return (
    <a href={m.linkUrl} className="btn btn-sm" target="_blank" rel="noreferrer">
      {m.linkLabel || "Ouvrir le lien"}
      <ExternalLink aria-hidden className="size-4" />
    </a>
  );
}

function ToneTag({ tone }: { tone: BroadcastDTO["tone"] }) {
  const t = BROADCAST_TONE[tone];
  const Icon = t.icon;
  return (
    <span className="pc-update-tone">
      <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
      {t.label}
    </span>
  );
}

/** Le message le plus récent : la même affiche que celle qui s'ouvre par-dessus la page, posée à plat. */
function Latest({ m }: { m: BroadcastDTO }) {
  const Icon = BROADCAST_TONE[m.tone].icon;
  return (
    <article id={`maj-${m.id}`} className="pc-update-latest" data-tone={m.tone} aria-labelledby={`maj-${m.id}-t`}>
      <header className="pc-broadcast-band cover-texture">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
          <Icon aria-hidden className="size-4" strokeWidth={2.25} />
          {BROADCAST_TONE[m.tone].label}
          <span aria-hidden>·</span>
          {m.sentAt && <time dateTime={m.sentAt}>{longFmt.format(new Date(m.sentAt))}</time>}
        </div>
        <h2
          id={`maj-${m.id}-t`}
          className="mt-2 font-display text-[clamp(1.9rem,1.5rem+1.6vw,2.6rem)] uppercase leading-[0.95] [text-wrap:balance]"
        >
          {m.title}
        </h2>
      </header>
      <div className="px-5 pb-5 pt-4 sm:px-6">
        <Body text={m.body} />
        {m.linkUrl && (
          <div className="mt-4 border-t-2 border-dashed border-line pt-4">
            <MessageLink m={m} />
          </div>
        )}
      </div>
    </article>
  );
}

/** Un message plus ancien : tampon de date à gauche, texte à droite. */
function Entry({ m }: { m: BroadcastDTO }) {
  const at = m.sentAt ? new Date(m.sentAt) : null;
  return (
    <li className="pc-update-entry" data-tone={m.tone}>
      <article id={`maj-${m.id}`} aria-labelledby={`maj-${m.id}-t`}>
        {at ? (
          <time dateTime={m.sentAt!} className="pc-update-date" title={longFmt.format(at)}>
            <span className="pc-update-day tnum">{dayFmt.format(at)}</span>
            <span className="pc-update-month">{monthFmt.format(at).replace(".", "")}</span>
            <span className="sr-only"> {yearFmt.format(at)}</span>
          </time>
        ) : (
          <span />
        )}
        <div className="min-w-0">
          <ToneTag tone={m.tone} />
          <h3
            id={`maj-${m.id}-t`}
            className="mt-1.5 font-display text-[1.45rem] uppercase leading-[1.02] [text-wrap:balance]"
          >
            {m.title}
          </h3>
          <div className="mt-2">
            <Body text={m.body} />
          </div>
          {m.linkUrl && (
            <div className="mt-3">
              <MessageLink m={m} />
            </div>
          )}
        </div>
      </article>
    </li>
  );
}

export default function UpdatesPage() {
  useSeenFeature("updates");
  const list = useSWR<BroadcastDTO[]>("/broadcasts");
  const [latest, ...older] = list.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Dernières mises à jour</h1>
        <p className="hatnote mt-2 max-w-[62ch]">
          Tous les messages de Palawi, du plus récent au plus ancien. Un message fermé trop vite se relit ici.
        </p>
      </div>

      {list.error ? (
        <ErrorBox error={list.error} retry={() => list.mutate()} />
      ) : !list.data ? (
        <div className="flex max-w-3xl flex-col gap-4" aria-busy>
          <div className="h-64 animate-pulse rounded-[18px] bg-panel" />
          <div className="h-28 animate-pulse rounded-xl bg-panel" />
        </div>
      ) : !latest ? (
        <Empty title="Aucun message pour l'instant">
          Les annonces de Palawi (mises à jour, événements) apparaîtront ici.
        </Empty>
      ) : (
        <div className="pc-updates flex max-w-3xl flex-col">
          <Latest m={latest} />
          {older.length > 0 && (
            <section aria-labelledby="maj-avant">
              <h2 id="maj-avant" className="section-title">
                Avant
              </h2>
              <ol className="flex flex-col">
                {older.map((m) => (
                  <Entry key={m.id} m={m} />
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
