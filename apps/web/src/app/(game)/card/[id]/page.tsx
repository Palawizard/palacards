"use client";

import { ECONOMY, RARITY_LABELS } from "@palacards/game";
import type { CardDTO, ReferencePriceDTO } from "@palacards/shared";
import { ExternalLink, Gavel, Heart, Repeat, Star, Tag } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Card, RaritySigil } from "@/components/Card";
import { ReferenceLine, SellForm } from "@/components/market";
import { ConfirmDialog, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { compact, fmt, relative } from "@/lib/format";

export interface CardSheet {
  card: CardDTO;
  pageLen: number;
  extract: string | null;
  inActiveSeason: boolean;
  owners: { userId: string; username: string; copies: number; bestLevel: number }[];
  mine: CardDTO[];
  wishlisted: boolean;
}

function InstanceRow({ card, onChanged }: { card: CardDTO; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [selling, setSelling] = useState(false);
  const [tags, setTags] = useState((card.tags ?? []).join(", "));
  const [confirm, setConfirm] = useState(false);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    }
  }

  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 last:border-0 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <RaritySigil rarity={card.rarity} />
        <div className="tnum text-sm">
          <span className="font-semibold">
            ATK {fmt(card.atk)} · DEF {fmt(card.def)}
          </span>
          <span className="block text-xs text-faint">
            Édition S{card.season} · niveau {card.level} · obtenue {card.obtainedAt ? relative(card.obtainedAt) : ""}
            {card.locked && ` · ${card.locked === "auction" ? "en vente" : "dans un échange"}`}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={`btn btn-sm ${card.favorite ? "text-warn" : ""}`}
          aria-pressed={!!card.favorite}
          onClick={() =>
            run(() => api(`/collection/${card.instanceId}/favorite`, { body: { favorite: !card.favorite } }))
          }
        >
          <Star aria-hidden className={`size-4 ${card.favorite ? "fill-current" : ""}`} />
          {card.favorite ? "Favorite" : "Favori"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          <Tag aria-hidden className="size-4" />
          Tags{card.tags?.length ? ` (${card.tags.length})` : ""}
        </button>
        <button type="button" className="btn btn-sm" disabled={!!card.locked} onClick={() => setSelling((v) => !v)} aria-expanded={selling}>
          <Gavel aria-hidden className="size-4" />
          Vendre
        </button>
        <Link href={`/trades/new?give=${card.instanceId}`} className={`btn btn-sm ${card.locked ? "pointer-events-none opacity-45" : ""}`} aria-disabled={!!card.locked}>
          <Repeat aria-hidden className="size-4" />
          Échanger
        </Link>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={!!card.locked}
          onClick={() => setConfirm(true)}
        >
          Recycler +{ECONOMY.recycleValue[card.rarity]}
        </button>
      </div>
      {selling && (
        <div className="w-full sm:basis-full">
          <SellForm
            card={card}
            onDone={() => {
              setSelling(false);
              onChanged();
            }}
          />
        </div>
      )}
      {editing && (
        <form
          className="flex w-full gap-2 sm:basis-full"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                api(`/collection/${card.instanceId}/tags`, {
                  method: "PUT",
                  body: {
                    tags: tags
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  },
                }),
              "Tags enregistrés.",
            );
            setEditing(false);
          }}
        >
          <input
            className="field h-9 min-h-0 text-sm"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="histoire, top, à échanger"
            aria-label="Tags, séparés par des virgules"
          />
          <button type="submit" className="btn btn-sm btn-primary">
            Enregistrer
          </button>
        </form>
      )}
      <ConfirmDialog
        open={confirm}
        danger
        title="Recycler cet exemplaire ?"
        confirmLabel={`Recycler (+${ECONOMY.recycleValue[card.rarity]} PW)`}
        onConfirm={() =>
          run(
            () => api("/collection/recycle", { body: { instanceIds: [card.instanceId] } }),
            `+${ECONOMY.recycleValue[card.rarity]} PW`,
          )
        }
        onClose={() => setConfirm(false)}
      >
        L’exemplaire disparaît de ta collection contre {ECONOMY.recycleValue[card.rarity]} points wiki.
      </ConfirmDialog>
    </li>
  );
}

function WishButton({ cardId, wishlisted, onChanged }: { cardId: number; wishlisted: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`btn w-full ${wishlisted ? "border-accent text-accent" : ""}`}
      aria-pressed={wishlisted}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/wishlist/${cardId}`, { method: wishlisted ? "DELETE" : "PUT" });
          toast.success(wishlisted ? "Retirée de ta wishlist." : "Ajoutée à ta wishlist : tu seras prévenu à sa mise en vente.");
          onChanged();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Action impossible.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Heart aria-hidden className={`size-4 ${wishlisted ? "fill-current" : ""}`} />
      {wishlisted ? "Dans ma wishlist" : "Ajouter à ma wishlist"}
    </button>
  );
}

function PriceHistory({ cardId }: { cardId: number }) {
  const { data } = useSWR<{ reference: ReferencePriceDTO | null; sales: { price: number; soldAt: string; rarity: string }[] }>(
    `/cards/${cardId}/prices`,
  );
  return (
    <section className="infobox text-sm">
      <h2 className="infobox-head">Historique des prix</h2>
      <p className="px-3 pt-2 text-xs">
        <ReferenceLine reference={data?.reference ?? null} />
      </p>
      {data?.sales.length ? (
        <table className="tnum mt-1 w-full">
          <tbody>
            {data.sales.slice(0, 10).map((s, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-3 py-1.5 text-muted">{new Date(s.soldAt).toLocaleDateString("fr-FR")}</td>
                <td className="px-3 py-1.5 text-right">{fmt(s.price)} PW</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-3 pb-3 pt-1 text-xs text-faint">Jamais vendue au marché.</p>
      )}
    </section>
  );
}

export default function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate } = useSWR<CardSheet>(`/cards/${id}`);

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!data) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <div className="h-12 w-2/3 animate-pulse rounded bg-panel" />
        <div className="h-64 animate-pulse rounded bg-panel" />
      </div>
    );
  }
  const { card } = data;

  return (
    <article className="flex flex-col gap-2">
      <h1 className="page-title">{card.title}</h1>
      <p className="hatnote">
        Carte {RARITY_LABELS[card.rarity].toLowerCase()} de la saison {card.season}
        {!data.inActiveSeason && " (article absent de la saison en cours)"}.
      </p>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
        <aside className="order-first flex flex-col gap-3 lg:order-last">
          <div className="mx-auto w-full max-w-[18rem]">
            <Card card={card} href={null} priority />
          </div>
          <table className="infobox tnum w-full text-sm">
            <tbody>
              {[
                ["Rareté", <RaritySigil key="r" rarity={card.rarity} withLabel />],
                ["Vues (12 mois)", fmt(card.views12m ?? 0)],
                ["Longueur", `${fmt(data.pageLen)} octets`],
                ["Attaque", fmt(card.atk)],
                ["Défense", fmt(card.def)],
                ["Édition", `Saison ${card.season}`],
              ].map(([k, v]) => (
                <tr key={String(k)} className="border-b border-line last:border-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-semibold text-muted">
                    {k}
                  </th>
                  <td className="px-3 py-1.5 text-right">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <WishButton cardId={card.cardId} wishlisted={data.wishlisted} onChanged={() => mutate()} />
          <PriceHistory cardId={card.cardId} />
        </aside>

        <div className="min-w-0">
          {data.extract ? (
            <p className="max-w-[68ch] font-serif text-[1.12rem] leading-[1.65]">{data.extract}</p>
          ) : (
            <p className="text-muted">Le résumé de l’article n’est pas encore chargé.</p>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <a
              href={card.pageUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="article-link inline-flex items-center gap-1"
            >
              Lire l’article sur Wikipédia <ExternalLink aria-hidden className="size-3.5" />
            </a>
            <span className="text-faint">
              Texte et image : contributeurs de Wikipédia, licence{" "}
              <a
                className="article-link"
                href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr"
                target="_blank"
                rel="noreferrer"
              >
                CC BY-SA 4.0
              </a>
              .
            </span>
          </p>

          <h2 className="section-title">Mes exemplaires</h2>
          {data.mine.length ? (
            <ul>
              {data.mine.map((c) => (
                <InstanceRow key={c.instanceId} card={c} onChanged={() => mutate()} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              Tu n’as pas encore cette carte.{" "}
              <Link href="/pulls" className="article-link">
                Ouvrir un paquet
              </Link>
            </p>
          )}

          <h2 className="section-title">Détenteurs</h2>
          {data.owners.length ? (
            <ul className="flex flex-wrap gap-2">
              {data.owners.map((o) => (
                <li key={o.userId}>
                  <Link href={`/u/${o.username.toLowerCase()}`} className="chip hover:text-text">
                    {o.username}
                    <span className="tnum text-faint">×{o.copies}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              Personne ne possède encore cet article. {compact(card.views12m ?? 0)} lecteurs l’ont pourtant ouvert cette
              année.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
