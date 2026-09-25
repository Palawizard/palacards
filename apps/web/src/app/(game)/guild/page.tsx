"use client";

import { GUILD_MAX_MEMBERS } from "@palacards/game";
import { Crown, MessageSquare, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog, Empty, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useMe } from "@/lib/game";

type Role = "leader" | "officer" | "member";
interface Member {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  role: Role;
  elo: number;
  score: number;
  online: boolean;
}
interface GuildDetail {
  id: number;
  name: string;
  tag: string;
  emblem: string;
  description: string;
  season: number;
  score: number;
  members: Member[];
  maxMembers: number;
  myRole?: Role;
  objective: { label: string; target: number; progress: number; completed: boolean; weekStart: string };
}
interface GuildSummary {
  id: number;
  name: string;
  tag: string;
  emblem: string;
  description: string;
  members: number;
  score: number;
}

const ROLE_LABEL: Record<Role, string> = { leader: "Chef", officer: "Officier", member: "Membre" };
const EMBLEMS = ["🦉", "📚", "🗺️", "⚔️", "🌍", "🔭", "🎭", "🧪", "🏛️", "🐉", "🌋", "🎼"];

function run(fn: () => Promise<unknown>, ok: string, after: () => void) {
  fn()
    .then(() => {
      toast.success(ok);
      after();
    })
    .catch((err) => toast.error(err instanceof ApiError ? err.message : "Action impossible."));
}

function NoGuild({ onChanged }: { onChanged: () => void }) {
  const { data, error, mutate } = useSWR<GuildSummary[]>("/guilds");
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [emblem, setEmblem] = useState(EMBLEMS[0]!);
  const [description, setDescription] = useState("");

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <section>
        <h2 className="section-title mt-0">Rejoindre une guilde</h2>
        {error ? (
          <ErrorBox error={error} retry={() => mutate()} />
        ) : !data ? (
          <div className="h-40 animate-pulse rounded-md bg-panel" />
        ) : data.length === 0 ? (
          <Empty title="Aucune guilde pour l’instant">Fonde la première !</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-panel">
            {data.map((g, i) => (
              <li key={g.id} className="flex items-center gap-3 px-3 py-3">
                <span className="tnum w-6 text-right text-sm text-faint">{i + 1}</span>
                <span
                  className="grid size-10 place-items-center rounded-md border border-line-strong bg-panel-2 text-xl"
                  aria-hidden
                >
                  {g.emblem}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-lg">
                    {g.name} <span className="text-sm text-faint">[{g.tag}]</span>
                  </span>
                  <span className="tnum text-xs text-muted">
                    {g.members}/{GUILD_MAX_MEMBERS} membres · {fmt(g.score)} pts de saison
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={g.members >= GUILD_MAX_MEMBERS}
                  onClick={() =>
                    run(() => api(`/guilds/${g.id}/join`, { method: "POST" }), `Bienvenue chez ${g.name} !`, onChanged)
                  }
                >
                  {g.members >= GUILD_MAX_MEMBERS ? "Complète" : "Rejoindre"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        className="infobox"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api("/guilds", { body: { name, tag, emblem, description } }), "Guilde fondée !", onChanged);
        }}
      >
        <h2 className="infobox-head">Fonder une guilde</h2>
        <div className="flex flex-col gap-3 p-3">
          <label>
            <span className="label">Nom</span>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={3}
              maxLength={30}
              required
            />
          </label>
          <label>
            <span className="label">Blason (2 à 5 lettres)</span>
            <input
              className="field uppercase"
              value={tag}
              onChange={(e) => setTag(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 5))}
              required
            />
          </label>
          <fieldset>
            <legend className="label">Emblème</legend>
            <div className="flex flex-wrap gap-1.5">
              {EMBLEMS.map((em) => (
                <button
                  key={em}
                  type="button"
                  aria-pressed={emblem === em}
                  onClick={() => setEmblem(em)}
                  className="grid size-9 place-items-center rounded-md border border-line-strong text-lg transition-colors duration-150 hover:border-faint aria-pressed:border-accent aria-pressed:bg-accent/15"
                >
                  {em}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            <span className="label">Description (facultatif)</span>
            <textarea
              className="field min-h-16"
              maxLength={280}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={name.trim().length < 3 || tag.length < 2}>
            Fonder
          </button>
        </div>
      </form>
    </div>
  );
}

function MyGuild({ guild, onChanged }: { guild: GuildDetail; onChanged: () => void }) {
  const { me } = useMe();
  const [leaving, setLeaving] = useState(false);
  const [pending, setPending] = useState<{ m: Member; action: "kick" | "transfer" } | null>(null);
  const myRole = guild.myRole ?? "member";
  const pct = Math.round((guild.objective.progress / guild.objective.target) * 100);
  const act = (m: Member, action: "promote" | "demote" | "kick" | "transfer", ok: string) =>
    run(() => api(`/guilds/members/${m.id}/${action}`, { method: "POST" }), ok, onChanged);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-4">
        <span
          className="grid size-16 place-items-center rounded-lg border border-line-strong bg-panel-2 text-4xl"
          aria-hidden
        >
          {guild.emblem}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-3xl leading-tight">
            {guild.name} <span className="text-lg text-faint">[{guild.tag}]</span>
          </h2>
          {guild.description && <p className="text-muted">{guild.description}</p>}
        </div>
        <Link href={`/messages?channel=guild:${guild.id}`} className="btn">
          <MessageSquare aria-hidden className="size-4" /> Salon de la guilde
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="infobox">
          <h3 className="infobox-head">Objectif de la semaine</h3>
          <div className="p-3">
            <p className="font-semibold">{guild.objective.label}</p>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2"
              role="progressbar"
              aria-valuenow={guild.objective.progress}
              aria-valuemax={guild.objective.target}
              aria-label="Progression de l'objectif"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="tnum mt-1.5 text-sm text-muted">
              {fmt(guild.objective.progress)} / {fmt(guild.objective.target)}
              {guild.objective.completed
                ? " · atteint : un paquet bonus pour chacun !"
                : " · récompense : un paquet bonus par membre"}
            </p>
          </div>
        </section>
        <section className="infobox">
          <h3 className="infobox-head">Saison {guild.season}</h3>
          <div className="tnum p-3">
            <p className="text-3xl font-semibold">{fmt(guild.score)}</p>
            <p className="text-sm text-muted">points de collection cumulés par les {guild.members.length} membres</p>
          </div>
        </section>
      </div>

      <section>
        <h3 className="section-title mt-0">
          Membres{" "}
          <span className="tnum text-base text-faint">
            ({guild.members.length}/{guild.maxMembers})
          </span>
        </h3>
        <ul className="divide-y divide-line rounded-md border border-line bg-panel">
          {guild.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Avatar name={m.displayName} avatar={m.avatar} online={m.online} />
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
                <span className="tnum block text-xs text-faint">
                  {fmt(m.score)} pts · Elo {fmt(m.elo)}
                </span>
              </span>
              {m.id !== me?.id && (
                <span className="flex flex-wrap gap-1">
                  {myRole === "leader" && m.role === "member" && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => act(m, "promote", `${m.displayName} est officier.`)}
                    >
                      Promouvoir
                    </button>
                  )}
                  {myRole === "leader" && m.role === "officer" && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => act(m, "demote", `${m.displayName} redevient membre.`)}
                      >
                        Rétrograder
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setPending({ m, action: "transfer" })}
                      >
                        Nommer chef
                      </button>
                    </>
                  )}
                  {(myRole === "leader" ? m.role !== "leader" : myRole === "officer" && m.role === "member") && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => setPending({ m, action: "kick" })}
                    >
                      Exclure
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div>
        <button type="button" className="btn btn-danger btn-sm" onClick={() => setLeaving(true)}>
          Quitter la guilde
        </button>
      </div>
      <ConfirmDialog
        open={!!pending}
        danger={pending?.action === "kick"}
        title={
          pending?.action === "kick"
            ? `Exclure ${pending.m.displayName} ?`
            : `Nommer ${pending?.m.displayName ?? ""} chef ?`
        }
        confirmLabel={pending?.action === "kick" ? "Exclure" : "Nommer chef"}
        onConfirm={() =>
          pending &&
          act(
            pending.m,
            pending.action,
            pending.action === "kick"
              ? `${pending.m.displayName} a été exclu.`
              : `${pending.m.displayName} est le nouveau chef.`,
          )
        }
        onClose={() => setPending(null)}
      >
        {pending?.action === "kick"
          ? "Il pourra revenir plus tard s’il le souhaite."
          : "Tu deviendras officier et ne pourras plus reprendre la tête toi-même."}
      </ConfirmDialog>
      <ConfirmDialog
        open={leaving}
        danger
        title="Quitter la guilde ?"
        confirmLabel="Quitter"
        onConfirm={() => run(() => api("/guilds/leave", { method: "POST" }), "Tu as quitté la guilde.", onChanged)}
        onClose={() => setLeaving(false)}
      >
        {myRole === "leader"
          ? "Tu es chef : le plus ancien officier (ou membre) prendra ta place. Une guilde vide est dissoute."
          : "Tu pourras en rejoindre une autre à tout moment."}
      </ConfirmDialog>
    </div>
  );
}

export default function GuildPage() {
  const { data, error, mutate } = useSWR<GuildDetail | null>("/guilds/mine");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Guilde</h1>
        <p className="hatnote mt-2">
          Jusqu’à {GUILD_MAX_MEMBERS} membres, un salon commun et un objectif chaque semaine qui rapporte un paquet
          bonus à tous.
        </p>
      </div>
      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : data === undefined ? (
        <div className="h-60 animate-pulse rounded-md bg-panel" aria-busy />
      ) : data ? (
        <MyGuild guild={data} onChanged={() => mutate()} />
      ) : (
        <NoGuild onChanged={() => mutate()} />
      )}
    </div>
  );
}
