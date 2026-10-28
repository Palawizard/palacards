"use client";

import type { PublicGuildDTO } from "@palacards/shared";
import { Crown, ShieldCheck, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Avatar } from "@/components/Avatar";
import { ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";

const ROLE_LABEL = { leader: "Chef", officer: "Officier", member: "Membre" } as const;
const since = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

/**
 * Page publique d'une guilde (suggestion n° 110) : emblème, rang et score de la saison, membres et leurs points.
 * Rien de réservé aux membres (objectif de la semaine, salon, gestion) ; un membre est renvoyé vers sa page /guild.
 */
export default function PublicGuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: g, error, mutate } = useSWR<PublicGuildDTO>(/^\d+$/.test(id) ? `/guilds/${id}` : null);
  const [joining, setJoining] = useState(false);
  const member = !!g?.member;
  useEffect(() => {
    if (member) router.replace("/guild");
  }, [member, router]);

  async function join() {
    if (!g) return;
    setJoining(true);
    try {
      await api(`/guilds/${g.id}/join`, { method: "POST" });
      toast.success(`Bienvenue chez ${g.name} !`);
      router.push("/guild");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de rejoindre cette guilde.");
      void mutate();
    } finally {
      setJoining(false);
    }
  }

  if (!/^\d+$/.test(id)) return <ErrorBox error={new ApiError(404, "not_found", "Cette guilde n'existe pas.")} />;
  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!g || g.member) return <div className="h-72 animate-pulse rounded-xl bg-panel" aria-busy />;
  const full = g.members.length >= g.maxMembers;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-4 border-b-2 border-dashed border-line pb-4">
        <span
          className="grid size-20 shrink-0 place-items-center rounded-2xl border border-line-strong bg-panel-2 text-5xl shadow-lift"
          aria-hidden
        >
          {g.emblem}
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="font-display text-[clamp(2rem,1.5rem+1.9vw,2.9rem)] uppercase leading-none [text-wrap:balance]">
            {g.name} <span className="text-[0.55em] text-faint">[{g.tag}]</span>
          </h1>
          <p className="mt-1 text-sm text-muted">Guilde fondée en {since(g.createdAt)}</p>
          {g.description && <p className="mt-2 max-w-prose [text-wrap:pretty]">{g.description}</p>}
        </div>
        {g.canJoin && (
          <button type="button" className="btn btn-primary" disabled={joining} onClick={join}>
            Rejoindre
          </button>
        )}
        {!g.canJoin && full && <span className="chip">Complète</span>}
      </header>

      <dl
        className="tnum grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-line [&>div]:bg-panel"
        style={{ gap: 1 }}
      >
        <div className="px-4 py-3">
          <dt className="text-xs text-faint">Classement des guildes</dt>
          <dd className="flex items-baseline gap-1.5 text-xl font-semibold">
            {g.rank <= 3 && <Trophy aria-hidden className="size-4 self-center text-warn" />}
            {g.rank}
            <sup className="-ml-1 text-xs">{g.rank === 1 ? "re" : "e"}</sup>
            <span className="text-sm font-normal text-faint">sur {fmt(g.guilds)}</span>
          </dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-xs text-faint">Score · saison {g.season}</dt>
          <dd className="text-xl font-semibold">{fmt(g.score)}</dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-xs text-faint">Membres</dt>
          <dd className="text-xl font-semibold">
            {g.members.length}
            <span className="text-sm font-normal text-faint"> / {g.maxMembers}</span>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="members-title">
        <h2 id="members-title" className="section-title mt-0">
          Membres
        </h2>
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
          {g.members.map((m) => (
            <li key={m.username} className="flex items-center gap-3 px-3 py-2.5">
              <Link href={`/u/${m.username}`} tabIndex={-1} aria-hidden className="rounded-full">
                <Avatar name={m.displayName} avatar={m.avatar} />
              </Link>
              <span className="min-w-0 flex-1">
                <Link href={`/u/${m.username}`} className="font-semibold hover:underline">
                  {m.displayName}
                </Link>
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted">
                  {m.role === "leader" ? (
                    <Crown aria-hidden className="size-3.5 text-warn" />
                  ) : m.role === "officer" ? (
                    <ShieldCheck aria-hidden className="size-3.5 text-link" />
                  ) : null}
                  {ROLE_LABEL[m.role]}
                </span>
              </span>
              <span className="tnum text-right text-sm">
                <span className="font-semibold">{fmt(m.score)}</span>
                <span className="block text-xs text-faint">pts de saison</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-faint">
          Le score de la guilde additionne les points de collection de la saison de ses membres.
        </p>
      </section>
    </div>
  );
}
