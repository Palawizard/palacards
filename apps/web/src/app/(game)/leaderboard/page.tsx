"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { ErrorBox } from "@/components/ui";
import { fmt } from "@/lib/format";

type Board = "collection" | "elo" | "wealth" | "guilds";
interface Row {
  id: string;
  name: string;
  username: string | null;
  value: number;
  extra?: string;
  rank: number;
  me: boolean;
}

const BOARDS: { value: Board; label: string; unit: string }[] = [
  { value: "collection", label: "Collection", unit: "pts" },
  { value: "elo", label: "Elo de bataille", unit: "Elo" },
  { value: "wealth", label: "Richesse", unit: "PW" },
  { value: "guilds", label: "Guildes", unit: "pts" },
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
          000 pour une légendaire). Les classements de saison repartent à zéro chaque mois.
        </p>
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
        <div className="h-96 animate-pulse rounded-md bg-panel" />
      ) : data.rows.length === 0 ? (
        <p className="text-muted">Personne au classement pour l’instant.</p>
      ) : (
        <table
          aria-busy={isLoading}
          className={`tnum w-full overflow-hidden rounded-md border border-line bg-panel text-sm transition-opacity duration-150 ${isLoading ? "opacity-60" : ""}`}
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
                <td className={`px-3 py-2 text-right font-serif text-base ${r.rank <= 3 ? "text-warn" : "text-faint"}`}>
                  {r.rank}
                </td>
                <td className="px-3 py-2">
                  {r.username ? (
                    <Link href={`/u/${r.username}`} className="font-semibold hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    <span className="font-semibold">
                      {r.name} {r.extra && <span className="text-faint">[{r.extra}]</span>}
                    </span>
                  )}
                  {r.me && <span className="ml-2 text-xs text-accent">toi</span>}
                </td>
                <td className="px-3 py-2 text-right font-semibold">{fmt(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
