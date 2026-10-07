"use client";

import Link from "next/link";
import { useState } from "react";
import { LUCK_MIN_PACKS, TITLE_MAX_RANK, type TitleBoard, type TitleRef } from "@palacards/game";
import useSWR from "swr";
import { Avatar } from "@/components/Avatar";
import { CreatorBadge, ErrorBox, TitleBadge } from "@/components/ui";
import { fmt } from "@/lib/format";

type Board = TitleBoard;
interface Row {
  id: string;
  name: string;
  username: string | null;
  /** Photo ou emoji du joueur ; emblème pour une guilde. */
  avatar: string | null;
  value: number;
  extra?: string;
  /** Classement « Chance » : boosters mesurés. */
  packs?: number;
  /** Badge « Créateur » (compte admin du jeu). */
  creator?: boolean;
  /** Titre affiché par le joueur. */
  title?: TitleRef;
  /** Note de statut du joueur. */
  statusNote?: string;
  rank: number;
  me: boolean;
}

const BOARDS: { value: Board; label: string; unit: string }[] = [
  { value: "collection", label: "Collection", unit: "pts" },
  { value: "legendary", label: "Légendaires", unit: "Légendaires" },
  { value: "packs", label: "Boosters ouverts", unit: "Boosters" },
  { value: "luck", label: "Chance", unit: "Chance" },
  { value: "elo", label: "Elo de bataille", unit: "Elo" },
  { value: "wealth", label: "Richesse", unit: "PW" },
  { value: "guilds", label: "Guildes", unit: "pts" },
  { value: "pass", label: "Passe de saison", unit: "niv." },
];

export default function LeaderboardPage() {
  const [board, setBoard] = useState<Board>("collection");
  const [period, setPeriod] = useState<"season" | "all">("season");
  // Garde l'ancien tableau (atténué) pendant le changement d'onglet : pas de flash de squelette.
  const { data, error, mutate, isLoading } = useSWR<{ season: number; rows: Row[] }>(
    `/leaderboard?board=${board}&period=${period}`,
    {
      keepPreviousData: true,
    },
  );
  const unit = BOARDS.find((b) => b.value === board)!.unit;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title">Classement</h1>
        <p className="hatnote mt-2">
          Le score de collection additionne les points de rareté des articles différents possédés (1 pour une commune, 1
          000 pour une légendaire). Les classements de saison repartent à zéro chaque mois&nbsp;: à la fin de la saison,
          les {TITLE_MAX_RANK} premiers de chacun gagnent un titre à afficher sur leur profil.
        </p>
        {board === "luck" && (
          <p className="hatnote mt-2">
            La chance compare les points de rareté tirés dans tes boosters (doublons compris) à ceux qu’on obtient en
            moyenne avec les mêmes boosters : 100&nbsp;% = chance moyenne, 150&nbsp;% = moitié mieux que la moyenne. Il
            faut au moins {LUCK_MIN_PACKS} boosters ouverts pour y figurer.
          </p>
        )}
        {board === "legendary" && (
          <p className="hatnote mt-2">
            Nombre d’articles légendaires différents possédés&nbsp;: un doublon ne compte qu’une fois. À égalité, le
            premier à avoir atteint ce nombre passe devant.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Classements" className="flex flex-wrap gap-1.5">
          {BOARDS.map((b) => (
            <button
              key={b.value}
              type="button"
              className="chip h-9 px-3.5"
              aria-pressed={board === b.value}
              onClick={() => setBoard(b.value)}
            >
              {b.label}
            </button>
          ))}
        </nav>
        <div className="flex gap-1.5" role="group" aria-label="Période">
          <button type="button" className="chip" aria-pressed={period === "season"} onClick={() => setPeriod("season")}>
            Saison {data?.season ?? ""}
          </button>
          <button type="button" className="chip" aria-pressed={period === "all"} onClick={() => setPeriod("all")}>
            Tout temps
          </button>
        </div>
      </div>

      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="h-96 animate-pulse rounded-xl bg-panel" />
      ) : data.rows.length === 0 ? (
        <p className="text-muted">
          {board === "luck"
            ? `Personne n’a encore ouvert ${LUCK_MIN_PACKS} boosters${period === "season" ? " cette saison" : ""}.`
            : board === "legendary"
              ? `Personne n’a encore de carte légendaire${period === "season" ? " cette saison" : ""}.`
              : "Personne au classement pour l’instant."}
        </p>
      ) : (
        <table
          aria-busy={isLoading}
          className={`tnum w-full overflow-hidden rounded-xl border border-line bg-panel text-sm transition-opacity duration-150 ${isLoading ? "opacity-60" : ""}`}
        >
          <thead>
            <tr className="border-b border-line text-left text-xs text-faint">
              <th scope="col" className="w-12 px-3 py-2 text-right font-semibold">
                Rang
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                {board === "guilds" ? "Guilde" : "Joueur"}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {unit}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className={`border-b border-line last:border-0 ${r.me ? "bg-accent/10" : ""}`}>
                <td
                  className={`px-3 py-2 text-right font-display text-base ${r.rank <= 3 ? "text-warn" : "text-faint"}`}
                >
                  {r.rank}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2.5">
                    {r.username ? (
                      // Doublon du lien du nom, hors tabulation : l'avatar aussi mène au profil.
                      <Link href={`/u/${r.username}`} tabIndex={-1} aria-hidden className="rounded-full">
                        <Avatar name={r.name} avatar={r.avatar} size="sm" />
                      </Link>
                    ) : (
                      <Avatar name={r.name} avatar={r.avatar} size="sm" />
                    )}
                    <div className="min-w-0">
                      {r.username ? (
                        <Link href={`/u/${r.username}`} className="font-semibold hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        <span className="font-semibold">
                          {r.name} {r.extra && <span className="text-faint">[{r.extra}]</span>}
                        </span>
                      )}
                      {r.creator && (
                        <span className="ml-2 align-[1px]">
                          <CreatorBadge />
                        </span>
                      )}
                      {r.title && (
                        <span className="ml-2 inline-flex max-w-full align-[1px]">
                          <TitleBadge title={r.title} />
                        </span>
                      )}
                      {r.me && <span className="ml-2 text-xs text-good">toi</span>}
                      {r.packs !== undefined && (
                        <span className="ml-2 text-xs text-faint">
                          {fmt(r.packs)} booster{r.packs > 1 ? "s" : ""}
                        </span>
                      )}
                      {r.statusNote && (
                        // Une ligne au plus, coupée au besoin : la note n'élargit jamais le tableau.
                        <p className="line-clamp-1 text-xs text-muted wrap-anywhere" title={r.statusNote}>
                          <span className="sr-only">Note : </span>
                          {r.statusNote}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {fmt(r.value)}
                  {board === "luck" && "\u00a0%"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
