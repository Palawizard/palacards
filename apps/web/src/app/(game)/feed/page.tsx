"use client";

import { FEED_REACTIONS } from "@palacards/game";
import type { FeedDTO, FeedItemDTO } from "@palacards/shared";
import { Biohazard, Bomb, Drama, Flame, Ghost, Skull, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import { AvatarFace } from "@/components/Avatar";
import { Card } from "@/components/Card";
import { ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { relative } from "@/lib/format";
import { useSeenFeature } from "@/lib/features";
import { useSocketEvent } from "@/lib/game";
import { useNow } from "@/lib/use-now";
import "@/components/content.css";

const GENRES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "sexe", label: "Sous la ceinture", icon: Flame },
  { key: "ww2", label: "Seconde Guerre mondiale", icon: Bomb },
  { key: "mort", label: "Crimes et morts", icon: Skull },
  { key: "paranormal", label: "Paranormal et complots", icon: Ghost },
  { key: "corps", label: "Pipi-caca", icon: Biohazard },
  { key: "insolite", label: "Insolite", icon: Drama },
];
const genreOf = (key: string) => GENRES.find((g) => g.key === key);

const SOURCE: Record<string, string> = {
  pack: "paquet",
  theme: "booster à thème",
  wheel: "roue du jour",
  upgrade: "upgrader",
  boss: "boss du jour",
};

/** Un tirage du fil : la vignette, qui l'a tirée et quand, et les réactions de la bande. */
function FeedItem({ item, fresh, now }: { item: FeedItemDTO; fresh: boolean; now: number }) {
  const [reactions, setReactions] = useState(item.reactions);
  const [prev, setPrev] = useState(item.reactions);
  if (prev !== item.reactions) {
    setPrev(item.reactions);
    setReactions(item.reactions);
  }
  async function react(emoji: string) {
    // Optimiste : la réaction s'affiche tout de suite, le serveur tranche ensuite.
    const before = reactions;
    const mine = reactions.find((r) => r.emoji === emoji)?.mine;
    setReactions((list) => {
      const others = list.filter((r) => r.emoji !== emoji);
      const cur = list.find((r) => r.emoji === emoji);
      const count = (cur?.count ?? 0) + (mine ? -1 : 1);
      return count > 0
        ? [...others, { emoji, count, mine: !mine }].sort(
            (a, b) =>
              FEED_REACTIONS.indexOf(a.emoji as (typeof FEED_REACTIONS)[number]) -
              FEED_REACTIONS.indexOf(b.emoji as (typeof FEED_REACTIONS)[number]),
          )
        : others;
    });
    try {
      const res = await api<{ reactions: FeedItemDTO["reactions"] }>(`/feed/${item.id}/react`, { body: { emoji } });
      setReactions(res.reactions);
    } catch (err) {
      setReactions(before);
      toast.error(err instanceof ApiError ? err.message : "Réaction impossible.");
    }
  }
  return (
    <article className="pc-feed-item flex flex-col gap-2" data-fresh={fresh || undefined}>
      <Card card={item.card} />
      <div className="flex items-center gap-2 text-xs">
        <Link
          href={`/u/${item.user.username}`}
          className="flex min-w-0 items-center gap-1.5 font-semibold hover:underline"
        >
          <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-panel-2 text-[0.7rem]">
            <AvatarFace name={item.user.name} avatar={item.user.avatar} />
          </span>
          <span className="truncate">{item.user.name}</span>
        </Link>
        <span className="ml-auto shrink-0 text-faint" title={`Tiré dans un ${SOURCE[item.source] ?? "paquet"}`}>
          {relative(item.createdAt, now)}
        </span>
      </div>
      {item.genres.length > 0 && (
        <p className="flex flex-wrap gap-1 text-[0.7rem] text-muted">
          {item.genres.map((g) => {
            const def = genreOf(g);
            if (!def) return null;
            const Icon = def.icon;
            return (
              <span key={g} className="inline-flex items-center gap-1 rounded-full bg-panel-2 px-1.5 py-0.5">
                <Icon className="size-3" aria-hidden />
                {def.label}
              </span>
            );
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Réagir">
        {FEED_REACTIONS.map((emoji) => {
          const r = reactions.find((x) => x.emoji === emoji);
          return (
            <button
              key={emoji}
              type="button"
              className="pc-react tnum"
              aria-pressed={!!r?.mine}
              aria-label={`Réagir ${emoji}${r ? ` (${r.count})` : ""}`}
              onClick={() => void react(emoji)}
            >
              <span aria-hidden>{emoji}</span>
              {r && <span className="text-[0.75rem] font-semibold">{r.count}</span>}
            </button>
          );
        })}
      </div>
    </article>
  );
}

/** Un rayon : une étagère qui défile à l'horizontale, chargée par pages. */
function Shelf({
  id,
  title,
  hint,
  query,
  empty,
  live,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  query: string;
  empty: string;
  live: FeedItemDTO[];
  children?: React.ReactNode;
}) {
  const now = useNow(30_000);
  const { data, error, size, setSize, isValidating, mutate } = useSWRInfinite<FeedDTO>(
    (i, prev) => (i > 0 && !prev?.nextCursor ? null : `/feed?${query}${i ? `&cursor=${prev!.nextCursor}` : ""}`),
    { revalidateFirstPage: false },
  );
  const loaded = data?.flatMap((p) => p.items) ?? [];
  const items = [...live.filter((l) => !loaded.some((x) => x.id === l.id)), ...loaded];
  const more = !!data?.at(-1)?.nextCursor;
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2 id={id} className="section-title !mb-1 !mt-0">
            {title}
          </h2>
          <p className="text-sm text-muted">{hint}</p>
        </div>
        {children}
      </div>
      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="pc-shelf" aria-hidden>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="slot aspect-[5/7] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="slot px-5 py-8 text-center text-sm text-muted">{empty}</p>
      ) : (
        <>
          <div className="pc-shelf" tabIndex={0} aria-label={title}>
            {items.map((item) => (
              <FeedItem key={item.id} item={item} now={now} fresh={live.some((l) => l.id === item.id)} />
            ))}
            {more && (
              <div className="grid place-items-center">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={isValidating}
                  onClick={() => void setSize(size + 1)}
                >
                  {isValidating ? "Chargement…" : "Plus ancien"}
                </button>
              </div>
            )}
          </div>
          <div className="pc-shelf-board" aria-hidden />
        </>
      )}
    </section>
  );
}

export default function FeedPage() {
  useSeenFeature("feed");
  const [genre, setGenre] = useState<string | null>(null);
  const [live, setLive] = useState<FeedItemDTO[]>([]);
  // Tirages marquants des autres joueurs, en direct : ils arrivent en tête des rayons concernés.
  useSocketEvent("feed:new", (item) => setLive((l) => [item, ...l].slice(0, 30)));

  const rank = (r: string) => ["C", "PC", "R", "SR", "UR", "L"].indexOf(r);
  const liveBest = live.filter((i) => rank(i.card.rarity) >= rank("SR") || i.card.shiny);
  const liveWeird = live.filter((i) => i.genres.length && (!genre || i.genres.includes(genre)));
  const liveShiny = live.filter((i) => i.card.shiny);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title">Fil d&apos;activité</h1>
        <p className="hatnote mt-2">
          Ce que la bande a tiré ces derniers jours : les plus belles cartes, les articles les plus improbables et les
          brillantes. Réagis pour chambrer.
        </p>
      </div>

      <Shelf
        id="feed-best"
        title="Meilleurs tirages"
        hint="Les plus rares des sept derniers jours."
        query="kind=best"
        empty="Personne n'a encore tiré de Super rare cette semaine."
        live={liveBest}
      />

      <Shelf
        id="feed-weird"
        title="Les plus bizarres"
        hint="Articles repérés dans les catégories les plus étranges de Wikipédia, ces deux dernières semaines."
        query={`kind=weird${genre ? `&genre=${genre}` : ""}`}
        empty="Rien de bizarre dans cette catégorie pour l'instant. Ça viendra."
        live={liveWeird}
      >
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par genre">
          <button type="button" className="chip" aria-pressed={genre === null} onClick={() => setGenre(null)}>
            Tout
          </button>
          {GENRES.map((g) => {
            const Icon = g.icon;
            return (
              <button
                key={g.key}
                type="button"
                className="chip"
                aria-pressed={genre === g.key}
                onClick={() => setGenre(genre === g.key ? null : g.key)}
              >
                <Icon className="size-3.5" aria-hidden />
                {g.label}
              </button>
            );
          })}
        </div>
      </Shelf>

      <Shelf
        id="feed-shiny"
        title="Brillantes"
        hint="Une carte sur mille sort brillante. Les voici, toutes raretés confondues."
        query="kind=shiny"
        empty="Aucune brillante pour l'instant : la première fera du bruit."
        live={liveShiny}
      />
    </div>
  );
}
