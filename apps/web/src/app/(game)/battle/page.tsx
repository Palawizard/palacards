"use client";

import { ATTACKS_PER_PLAYER, BATTLE_HP, DECK_SIZE, ECONOMY, OPEN_BATTLE_TTL_MS } from "@palacards/game";
import type { CardDTO, OpenBattleDTO } from "@palacards/shared";
import { Swords, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { AvatarFace } from "@/components/Avatar";
import { DeckPicker } from "@/components/DeckPicker";
import { PlayerSearch } from "@/components/PlayerSearch";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { countdown, relative } from "@/lib/format";
import { useMe, useSocketEvent } from "@/lib/game";
import { useNow } from "@/lib/use-now";

interface BattleSummary {
  id: number;
  status: "pending" | "declined" | "cancelled" | "active" | "finished";
  phase: string | null;
  isChallenger: boolean;
  opponent: { id: string; name: string; username: string; online: boolean };
  hp: { you: number; them: number } | null;
  result: "win" | "loss" | "draw" | null;
  forfeit: "you" | "them" | null;
  eloDelta: number | null;
  createdAt: string;
}

interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  online: boolean;
}

const RESULT: Record<string, string> = { win: "Victoire", loss: "Défaite", draw: "Nul" };

/** Règles en quatre temps : le déroulé d'un tour, dans l'ordre. */
function Rules() {
  const steps: [string, string][] = [
    ["Attaque", "Tu choisis une carte. Ton adversaire voit sa rareté et ses dégâts, pas son titre."],
    ["Bouclier", "Il choisit une de ses cartes pour se protéger : sa DEF réduit les dégâts, jusqu’à −50 %."],
    ["Question", "Il répond à un QCM sur l’article de ta carte, en 12 secondes."],
    ["Résultat", "Juste : paré. Juste en moins de 4 s : 20 % renvoyés. Faux : il prend les dégâts."],
  ];
  return (
    <section className="infobox" aria-labelledby="rules-title">
      <h2 id="rules-title" className="infobox-head">
        Un tour de duel
      </h2>
      <ol className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="tnum font-display text-2xl leading-none text-highlight">{i + 1}</span>
            <p className="text-sm leading-relaxed">
              <strong className="font-semibold">{title}.</strong> <span className="text-muted">{text}</span>
            </p>
          </li>
        ))}
      </ol>
      <p className="border-t-2 border-dashed border-line px-4 py-3 text-sm text-muted">
        {BATTLE_HP} PV chacun, {ATTACKS_PER_PLAYER} attaques chacun ; chaque carte attaque une fois et protège une fois.
        Une carte rare frappe fort, mais tout le monde la connaît.
      </p>
    </section>
  );
}

const OPEN_MINUTES = `${OPEN_BATTLE_TTL_MS / 60_000} min`;

function ChallengeForm({
  onDone,
  onOpened,
  hasOpen,
}: {
  onDone: () => void;
  onOpened: () => void;
  /** Tu as déjà un duel ouvert (un seul à la fois). */
  hasOpen: boolean;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const [opponent, setOpponent] = useState(params.get("opponent") ?? "");
  const [deck, setDeck] = useState<CardDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const { data: friends } = useSWR<{ friends: Friend[] }>("/friends");
  const online = friends?.friends.filter((f) => f.online) ?? [];

  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ id: number }>("/battles", {
        body: { opponent: opponent.trim(), deck: deck.map((c) => c.instanceId) },
      });
      toast.success("Défi envoyé !");
      onDone();
      router.push(`/battle/${res.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Défi impossible.");
    } finally {
      setBusy(false);
    }
  }
  async function openDuel() {
    setBusy(true);
    try {
      await api("/battles/open", { body: { deck: deck.map((c) => c.instanceId) } });
      toast.success("Duel ouvert : le premier joueur qui l’accepte t’affronte.");
      onOpened();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Duel ouvert impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="infobox">
      <h2 className="infobox-head">Lancer un duel</h2>
      <div className="flex flex-col gap-4 p-4">
        <div>
          <label className="block max-w-sm">
            <span className="label">Adversaire</span>
            <PlayerSearch value={opponent} onChange={setOpponent} placeholder="Pseudo d’un ami" />
          </label>
          {online.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-faint">En ligne :</span>
              {online.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="chip pl-1"
                  aria-pressed={opponent.trim().toLowerCase() === f.username}
                  onClick={() => setOpponent(f.username)}
                >
                  <span className="relative grid size-5 place-items-center overflow-hidden rounded-full bg-panel-2 text-[0.7rem]">
                    <AvatarFace name={f.displayName} avatar={f.avatar} />
                  </span>
                  {f.displayName}
                </button>
              ))}
            </div>
          ) : (
            friends && (
              <p className="mt-2 text-xs text-faint">
                Aucun ami en ligne pour l’instant : le duel se joue en direct, il pourra accepter dès qu’il se connecte.
                Ou lance un duel ouvert.
              </p>
            )
          )}
        </div>
        <DeckPicker deck={deck} onChange={setDeck} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto basis-full text-xs text-faint sm:basis-auto">
            {hasOpen
              ? "Ton duel ouvert attend un adversaire : annule-le pour en lancer un autre."
              : `Duel ouvert : sans adversaire choisi, le premier joueur qui l’accepte dans les ${OPEN_MINUTES} le joue.`}
          </p>
          <button
            type="button"
            className="btn"
            disabled={busy || deck.length !== DECK_SIZE || hasOpen}
            onClick={openDuel}
          >
            <Users aria-hidden className="size-4" /> Duel ouvert
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || deck.length !== DECK_SIZE || opponent.trim().length < 3}
            onClick={submit}
          >
            <Swords aria-hidden className="size-4" /> Défier
          </button>
        </div>
      </div>
    </section>
  );
}

function AcceptPanel({ battle, onDone }: { battle: BattleSummary; onDone: () => void }) {
  const router = useRouter();
  const [deck, setDeck] = useState<CardDTO[]>([]);
  const [busy, setBusy] = useState(false);
  async function act(accept: boolean) {
    setBusy(true);
    try {
      if (accept) {
        await api(`/battles/${battle.id}/accept`, { body: { deck: deck.map((c) => c.instanceId) } });
        router.push(`/battle/${battle.id}`);
      } else {
        await api(`/battles/${battle.id}/refuse`, { method: "POST" });
        toast("Défi refusé.");
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3 border-t border-line p-3">
      <DeckPicker deck={deck} onChange={setDeck} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => act(false)}>
          Refuser
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy || deck.length !== DECK_SIZE}
          onClick={() => act(true)}
        >
          Accepter le duel
        </button>
      </div>
    </div>
  );
}

/** Accepter un duel ouvert : choix du deck, puis le duel démarre (sauf si quelqu'un a été plus rapide). */
function JoinOpenPanel({ open, onDone }: { open: OpenBattleDTO; onDone: () => void }) {
  const router = useRouter();
  const [deck, setDeck] = useState<CardDTO[]>([]);
  const [busy, setBusy] = useState(false);
  async function join() {
    setBusy(true);
    try {
      const res = await api<{ id: number }>(`/battles/open/${open.id}/join`, {
        body: { deck: deck.map((c) => c.instanceId) },
      });
      router.push(`/battle/${res.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
      onDone();
    }
  }
  return (
    <div className="flex flex-col gap-3 border-t border-line p-3">
      <DeckPicker deck={deck} onChange={setDeck} />
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy || deck.length !== DECK_SIZE || !open.creator.online}
          onClick={join}
        >
          Accepter le duel
        </button>
      </div>
    </div>
  );
}

/** Duels ouverts : le tien (à annuler) et ceux des autres joueurs (le premier qui accepte joue). */
function OpenBattles({ open, onChange }: { open: OpenBattleDTO[]; onChange: () => void }) {
  const now = useNow(1000);
  const [accepting, setAccepting] = useState<number | null>(null);
  const live = open.filter((o) => new Date(o.expiresAt).getTime() > now);
  if (!live.length) return null;

  async function cancel(id: number) {
    try {
      await api(`/battles/open/${id}/cancel`, { method: "POST" });
      toast("Duel ouvert annulé.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      onChange();
    }
  }
  return (
    <section>
      <h2 className="section-title mt-0">Duels ouverts</h2>
      <ul className="flex flex-col gap-2">
        {live.map((o) => (
          <li
            key={o.id}
            className={`rounded-xl border bg-panel ${o.mine ? "border-line" : "border-accent/50 shadow-[var(--shadow-lift)]"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-panel-2 text-sm">
                  <AvatarFace name={o.creator.name} avatar={o.creator.avatar} />
                </span>
                <span className="min-w-0">
                  {o.mine ? (
                    <strong>Ton duel ouvert</strong>
                  ) : (
                    <>
                      <strong>{o.creator.name}</strong> cherche un adversaire{" "}
                      <span className="tnum text-muted">(Elo {o.creator.elo})</span>
                    </>
                  )}
                  <span className="block text-xs text-muted">
                    {o.mine ? "En attente d’un adversaire" : o.creator.online ? "En ligne" : "Hors ligne"} · expire dans{" "}
                    <span className="tnum">{countdown(new Date(o.expiresAt).getTime() - now)}</span>
                  </span>
                </span>
              </span>
              {o.mine ? (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => cancel(o.id)}>
                  Annuler
                </button>
              ) : (
                accepting !== o.id && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!o.creator.online}
                    onClick={() => setAccepting(o.id)}
                  >
                    Choisir mon deck
                  </button>
                )
              )}
            </div>
            {accepting === o.id && (
              <JoinOpenPanel
                open={o}
                onDone={() => {
                  setAccepting(null);
                  onChange();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Battles() {
  const { data, error, mutate } = useSWR<BattleSummary[]>("/battles");
  const { me } = useMe();
  const [accepting, setAccepting] = useState<number | null>(null);
  // Duels ouverts : relus à chaque changement (temps réel), et de temps en temps en filet de sécurité.
  const { data: open, mutate: mutateOpen } = useSWR<OpenBattleDTO[]>("/battles/open", { refreshInterval: 30_000 });
  useSocketEvent("battle:update", () => void mutate());
  useSocketEvent("battle:open", () => void mutateOpen());
  useSocketEvent("notification:new", (n) => {
    if (n.type.startsWith("battle_")) void mutate();
  });

  const incoming = data?.filter((x) => x.status === "pending" && !x.isChallenger) ?? [];
  const ongoing = data?.filter((x) => x.status === "active" || (x.status === "pending" && x.isChallenger)) ?? [];
  const history = data?.filter((x) => ["finished", "declined", "cancelled"].includes(x.status)) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Bataille</h1>
        <p className="hatnote mt-2">
          Duels en direct contre un ami, ou contre le premier joueur qui accepte ton duel ouvert : attaque avec tes
          cartes, défends-toi en répondant sur les siennes. Victoire {ECONOMY.battle.win} PW, défaite{" "}
          {ECONOMY.battle.loss} PW. Ton Elo :{" "}
          {me ? <span className="tnum font-semibold text-text">{me.elo ?? "…"}</span> : "…"}.
        </p>
      </div>

      {error && <ErrorBox error={error} retry={() => mutate()} />}

      {incoming.length > 0 && (
        <section>
          <h2 className="section-title mt-0">Défis reçus</h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((x) => (
              <li key={x.id} className="rounded-xl border border-accent/50 bg-panel shadow-[var(--shadow-lift)]">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <span>
                    <strong>{x.opponent.name}</strong> te défie{" "}
                    <span className="text-muted">
                      ({relative(x.createdAt)}
                      {x.opponent.online ? ", en ligne" : ", hors ligne"})
                    </span>
                  </span>
                  {accepting !== x.id && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setAccepting(x.id)}>
                      Choisir mon deck
                    </button>
                  )}
                </div>
                {accepting === x.id && (
                  <AcceptPanel
                    battle={x}
                    onDone={() => {
                      setAccepting(null);
                      void mutate();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ongoing.length > 0 && (
        <section>
          <h2 className="section-title mt-0">En cours</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
            {ongoing.map((x) => (
              <li key={x.id}>
                <Link
                  href={`/battle/${x.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 transition-colors duration-150 hover:bg-panel-2"
                >
                  <span>
                    Contre <strong>{x.opponent.name}</strong>
                  </span>
                  <span className="flex items-center gap-3 text-sm text-muted">
                    {x.status === "pending"
                      ? "en attente de réponse"
                      : x.phase === "lobby"
                        ? "accepté : rejoins le duel"
                        : x.hp
                          ? `${x.hp.you} PV contre ${x.hp.them}`
                          : "en cours"}
                    {x.status === "active" && <span className="btn btn-sm btn-primary">Rejoindre</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <OpenBattles open={open ?? []} onChange={() => void mutateOpen()} />

      <ChallengeForm onDone={() => mutate()} onOpened={() => void mutateOpen()} hasOpen={!!open?.some((o) => o.mine)} />

      <Rules />

      <section>
        <h2 className="section-title">Historique</h2>
        {!data ? (
          <div className="h-32 animate-pulse rounded-xl bg-panel" />
        ) : history.length === 0 ? (
          <Empty title="Aucun duel terminé">Défie un ami pour commencer.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
            {history.map((x) => (
              <li key={x.id}>
                <Link
                  href={`/battle/${x.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2.5 transition-colors duration-150 hover:bg-panel-2 sm:grid-cols-[1fr_auto_auto]"
                >
                  <span>
                    {x.status === "finished" ? (
                      <strong className={x.result === "win" ? "text-good" : x.result === "loss" ? "text-danger" : ""}>
                        {RESULT[x.result ?? "draw"]}
                      </strong>
                    ) : (
                      <span className="text-muted">{x.status === "declined" ? "Refusé" : "Annulé"}</span>
                    )}{" "}
                    contre {x.opponent.name}
                    {x.forfeit && (
                      <span className="text-muted"> ({x.forfeit === "you" ? "abandon" : "il a abandonné"})</span>
                    )}
                  </span>
                  <span className="tnum text-sm">
                    {x.status === "finished" && x.hp && `${x.hp.you} – ${x.hp.them} PV`}
                    {x.eloDelta !== null && x.status === "finished" && (
                      <span className={`ml-2 ${x.eloDelta >= 0 ? "text-good" : "text-danger"}`}>
                        {x.eloDelta >= 0 ? "+" : ""}
                        {x.eloDelta}
                      </span>
                    )}
                  </span>
                  <span className="hidden text-xs text-faint sm:block">{relative(x.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function BattlePage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-panel" />}>
      <Battles />
    </Suspense>
  );
}
