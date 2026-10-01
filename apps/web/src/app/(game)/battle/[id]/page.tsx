"use client";

import { ECONOMY, RARITY_LABELS } from "@palacards/game";
import type { BattleCardView, BattleStateDTO, BattleTurnView } from "@palacards/shared";
import { Check, ExternalLink, Flag, Shield, Swords, X, Zap } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { CardBackMini, CardStats, HandCard, HpBar, pct, questionLabel, TurnLine } from "@/components/Battle";
import { Card } from "@/components/Card";
import { ErrorBox } from "@/components/ui";
import { api, ApiError, thumbSrc } from "@/lib/api";
import { useConnection, useSocket, useSocketEvent } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";

const PHASE_ORDER = { lobby: 0, attack: 1, shield: 2, question: 3, reveal: 4 } as const;

/** Rang d'un état : un état plus ancien (réponse HTTP doublée par la socket) ne remplace jamais un plus récent. */
function rank(s: BattleStateDTO): number {
  if (s.status !== "active") return s.status === "pending" ? -1 : 10_000;
  return s.turn * 10 + (s.phase ? PHASE_ORDER[s.phase] : 0);
}

interface Snapshot {
  state: BattleStateDTO;
  /** Échéance locale de la phase (horloge du navigateur), déduite du temps restant envoyé par le serveur. */
  endsAt: number | null;
}

/** État du duel : lecture initiale, puis poussé par le serveur à chaque changement de phase. */
function useBattle(battleId: number) {
  const toSnap = (s: BattleStateDTO): Snapshot => ({
    state: s,
    endsAt: s.phaseRemainingMs === null ? null : Date.now() + s.phaseRemainingMs,
  });
  const accept = (s: BattleStateDTO) => setSnap((prev) => (prev && rank(prev.state) > rank(s) ? prev : toSnap(s)));
  const { data, error, mutate } = useSWR<BattleStateDTO>(`/battles/${battleId}`, { onSuccess: accept });
  const socket = useSocket();
  const connection = useConnection();
  // Données déjà en cache (retour sur l'écran) : affichées tout de suite, la relecture suit.
  const [snap, setSnap] = useState<Snapshot | null>(() => (data ? toSnap(data) : null));

  useEffect(() => {
    if (socket) socket.emit("battle:join", battleId);
  }, [socket, battleId, connection]);
  useSocketEvent("battle:state", (s) => {
    if (s.id === battleId) accept(s);
  });
  useSocketEvent("battle:update", ({ battleId: b }) => {
    if (b === battleId) void mutate();
  });
  return { snap, error, mutate, accept };
}

/** Chrono de phase : barre qui se vide et secondes restantes. */
function PhaseClock({ endsAt, total }: { endsAt: number; total: number }) {
  const now = useNow(200);
  const left = Math.max(0, endsAt - now);
  const ratio = total > 0 ? Math.min(1, left / total) : 0;
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="duel-clock flex-1" data-late={left < 4000}>
        <span style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <span className={`tnum w-6 text-right text-sm font-bold ${left < 4000 ? "text-danger" : ""}`}>
        {Math.ceil(left / 1000)}
      </span>
    </div>
  );
}

function phaseLabel(s: BattleStateDTO, youAttack: boolean): string {
  switch (s.phase) {
    case "lobby":
      return "Salle d'attente";
    case "attack":
      return youAttack ? "Ton attaque" : "Son attaque";
    case "shield":
      return youAttack ? "Il choisit son bouclier" : "Ton bouclier";
    case "question":
      return youAttack ? "Il répond" : "À toi de répondre";
    case "reveal":
      return "Résultat";
    default:
      return "";
  }
}

function Scoreboard({ s, endsAt }: { s: BattleStateDTO; endsAt: number | null }) {
  const youAttack = s.attackerId === s.you.id;
  return (
    <section className="infobox px-4 py-4 sm:px-5" aria-label="Tableau du duel">
      <div className="grid grid-cols-2 items-end gap-x-5 gap-y-3 sm:grid-cols-[1fr_auto_1fr] sm:gap-6">
        <HpBar player={s.you} max={s.maxHp} side="you" label="Toi" />
        <div className="order-first col-span-2 flex flex-col items-center gap-1 sm:order-none sm:col-span-1 sm:w-36 sm:pb-0.5">
          {s.status === "active" && s.turn > 0 ? (
            <>
              <span className="tnum font-display text-sm uppercase tracking-[0.04em] text-muted">
                Tour {s.turn}/{s.totalTurns}
              </span>
              <span className="flex items-center gap-1 text-center text-xs font-semibold leading-tight sm:text-sm">
                {s.phase === "attack" || s.phase === "shield" ? (
                  youAttack ? (
                    <Swords aria-hidden className="size-3.5 shrink-0 text-highlight" />
                  ) : (
                    <Shield aria-hidden className="size-3.5 shrink-0 text-highlight" />
                  )
                ) : null}
                {phaseLabel(s, youAttack)}
              </span>
            </>
          ) : (
            <span className="font-display text-2xl uppercase text-faint">VS</span>
          )}
        </div>
        <HpBar player={s.them} max={s.maxHp} side="them" label={s.them.name} />
      </div>
      {s.status === "active" && endsAt && s.phaseDurationMs ? (
        <div className="mx-auto mt-3 max-w-md">
          <PhaseClock endsAt={endsAt} total={s.phaseDurationMs} />
        </div>
      ) : null}
    </section>
  );
}

/** Carte attaquante au centre de la table : face visible pour l'attaquant, dos coloré pour le défenseur. */
function AttackCard({ card }: { card: BattleCardView }) {
  return (
    <div className="flex w-32 shrink-0 flex-col gap-1.5 sm:w-40">
      {card.card ? <Card card={card.card} href={null} /> : <CardBackMini card={card} />}
      <p className="tnum text-center text-sm">
        <span className="font-semibold text-danger">{card.damage} dégâts</span>
        <span className="text-faint"> si ça touche</span>
      </p>
    </div>
  );
}

function QuestionBlock({
  turn,
  canAnswer,
  pending,
  onAnswer,
}: {
  turn: BattleTurnView;
  canAnswer: boolean;
  pending: number | null;
  onAnswer: (i: number) => void;
}) {
  const q = turn.question!;
  const o = turn.outcome;
  const image = q.type === "image";
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <p className="font-display text-sm uppercase tracking-[0.05em] text-highlight">{questionLabel(q.type)}</p>
      <p
        className={
          q.type === "who_am_i" || q.type === "year"
            ? "max-w-[62ch] text-[1.05rem] leading-relaxed"
            : "text-lg font-semibold leading-snug"
        }
      >
        {q.prompt}
      </p>
      <div className={`grid gap-2 ${image ? "grid-cols-2 sm:grid-cols-4" : "sm:grid-cols-2"}`}>
        {q.choices.map((choice, i) => {
          const correct = o && i === o.correctIndex;
          const chosen = (o ? o.choice : pending) === i;
          const wrong = o && chosen && !correct;
          return (
            <button
              key={i}
              type="button"
              disabled={!canAnswer || pending !== null || !!o}
              onClick={() => onAnswer(i)}
              aria-pressed={chosen}
              className={`btn relative min-h-12 whitespace-normal text-left text-[0.95rem] font-medium disabled:opacity-100 ${
                image ? "aspect-square h-auto flex-col overflow-hidden p-1.5" : "justify-start py-2"
              } ${
                correct
                  ? "!border-good !bg-good/15"
                  : wrong
                    ? "!border-danger !bg-danger/10"
                    : chosen
                      ? "!border-highlight"
                      : o || !canAnswer
                        ? "opacity-70"
                        : ""
              }`}
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element -- vignettes Wikimedia relayées par l'API
                <img
                  src={thumbSrc(choice)}
                  alt={`Image ${i + 1}`}
                  className="size-full rounded-[7px] object-cover"
                  decoding="async"
                />
              ) : (
                <span className="flex-1">{choice}</span>
              )}
              {correct && (
                <Check
                  aria-label="Bonne réponse"
                  className={`size-5 shrink-0 text-good ${image ? "absolute right-2 top-2 rounded-full bg-panel p-0.5" : ""}`}
                />
              )}
              {wrong && (
                <X
                  aria-label="Mauvaise réponse"
                  className={`size-5 shrink-0 text-danger ${image ? "absolute right-2 top-2 rounded-full bg-panel p-0.5" : ""}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Résultat d'un tour : paré, parade parfaite ou touché, avec le calcul des dégâts en clair. */
function Outcome({ s, turn }: { s: BattleStateDTO; turn: BattleTurnView }) {
  const o = turn.outcome!;
  const youDefend = turn.defenderId === s.you.id;
  const attackTitle = turn.attack.card?.title ?? RARITY_LABELS[turn.attack.rarity];
  const pageUrl = turn.attack.card?.pageUrl;
  let headline: string;
  let tone: string;
  if (o.parry === "perfect") {
    headline = youDefend ? `Parade parfaite ! ${o.reflected} renvoyés` : `Parade parfaite : tu perds ${o.reflected} PV`;
    tone = youDefend ? "text-good" : "text-danger";
  } else if (o.parry === "parry") {
    headline = "Attaque parée";
    tone = youDefend ? "text-good" : "text-muted";
  } else {
    headline = youDefend ? `Touché : −${o.damage} PV` : `Touché ! −${o.damage} PV pour ${s.them.name}`;
    tone = youDefend ? "text-danger" : "text-good";
  }
  return (
    <motion.div
      initial={{ opacity: 0, transform: "translateY(6px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className="mt-4 border-t-2 border-dashed border-line pt-4"
      role="status"
    >
      <p className={`flex items-center gap-2 font-display text-2xl uppercase leading-tight ${tone}`}>
        {o.parry === "perfect" && <Zap aria-hidden className="size-5" />}
        {headline}
      </p>
      <p className="tnum mt-1 text-sm text-muted">
        {o.parry === "none" ? (
          <>
            {o.choice === null ? "Pas de réponse à temps. " : ""}
            {attackTitle} : {o.rawDamage} dégâts
            {o.shieldPct > 0 && turn.shield ? (
              <>
                {" "}
                · bouclier {turn.shield.card?.title ?? RARITY_LABELS[turn.shield.rarity]} −{pct(o.shieldPct)}
              </>
            ) : null}{" "}
            → <strong className="text-text">{o.damage}</strong>
          </>
        ) : o.parry === "perfect" ? (
          <>
            Bonne réponse en {((o.answerMs ?? 0) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
            {"\u00a0"}s : 20{"\u00a0"}% des {o.rawDamage} dégâts reviennent à l’attaquant.
          </>
        ) : (
          <>Bonne réponse : aucun dégât.</>
        )}
        {pageUrl && (
          <>
            {" "}
            <a href={pageUrl} target="_blank" rel="noreferrer" className="article-link inline-flex items-center gap-1">
              Lire l’article <ExternalLink aria-hidden className="size-3" />
            </a>
          </>
        )}
      </p>
    </motion.div>
  );
}

function Arena({
  s,
  endsAt,
  selected,
  busy,
  pendingChoice,
  onAnswer,
}: {
  s: BattleStateDTO;
  endsAt: number | null;
  selected: BattleCardView | null;
  busy: boolean;
  pendingChoice: number | null;
  onAnswer: (i: number) => void;
}) {
  const now = useNow(500);
  const youAttack = s.attackerId === s.you.id;
  const t = s.current;
  const key = `${s.turn}:${s.phase}`;
  const firstName = youAttack ? "Tu attaques" : `${s.them.name} attaque`;
  const intro =
    s.phase === "attack" && s.turn === 1 && endsAt !== null && s.phaseDurationMs !== null
      ? endsAt - now > s.phaseDurationMs - 3_000
      : false;

  let body: React.ReactNode;
  if (s.phase === "lobby") {
    body = (
      <div className="py-6 text-center">
        <p className="font-display text-3xl uppercase">En attente de {s.them.name}</p>
        <p className="mt-2 text-muted">
          Le duel démarre dès que vous êtes tous les deux sur cet écran.
          {!s.them.online && ` ${s.them.name} n’est pas connecté pour l’instant.`}
        </p>
      </div>
    );
  } else if (s.phase === "attack") {
    body = intro ? (
      <div className="py-6 text-center">
        <p className="font-display text-4xl uppercase text-highlight">Le duel commence</p>
        <p className="mt-2 text-lg">{firstName} en premier.</p>
      </div>
    ) : youAttack ? (
      <div className="py-2">
        <p className="font-display text-3xl uppercase">À toi d’attaquer</p>
        <p className="mt-1 max-w-[60ch] text-muted">
          Choisis une carte dans ta main. {s.them.name} verra sa rareté et ses dégâts, pas son titre, puis répondra à
          une question sur son article.
        </p>
        {selected && (
          <p className="tnum mt-3 text-sm">
            <span className="font-semibold">{selected.card?.title}</span> : {selected.damage} dégâts si {s.them.name} se
            trompe.
          </p>
        )}
      </div>
    ) : (
      <div className="py-2">
        <p className="font-display text-3xl uppercase">{s.them.name} choisit son attaque…</p>
        <p className="mt-1 max-w-[60ch] text-muted">
          Ensuite, choisis ton bouclier : chaque carte ne protège qu’une fois. Une carte très lue est souvent facile à
          reconnaître.
        </p>
      </div>
    );
  } else if (t && (s.phase === "shield" || s.phase === "question" || s.phase === "reveal")) {
    const youDefend = t.defenderId === s.you.id;
    const shieldPct = s.phase === "shield" ? (selected?.shieldPct ?? null) : (t.shield?.shieldPct ?? null);
    body = (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex items-start gap-3 sm:flex-col">
          <AttackCard card={t.attack} />
          {t.shield && (
            <p className="tnum flex items-center gap-1.5 text-sm text-muted sm:w-40 sm:justify-center">
              <Shield aria-hidden className="size-4 shrink-0" />
              {youDefend ? "Ton bouclier" : "Son bouclier"} : −{pct(t.shield.shieldPct)}
            </p>
          )}
        </div>
        {s.phase === "shield" ? (
          <div className="min-w-0 flex-1">
            {youDefend ? (
              <>
                <p className="font-display text-3xl uppercase">Choisis ton bouclier</p>
                <p className="mt-1 max-w-[60ch] text-muted">
                  {s.them.name} attaque avec une carte {RARITY_LABELS[t.attack.rarity].toLowerCase()}. Tu vas devoir
                  répondre à une question sur son article : bonne réponse, aucun dégât ; mauvaise, le bouclier réduit le
                  coup.
                </p>
                {shieldPct !== null && (
                  <p className="tnum mt-3 text-sm">
                    Si tu te trompes :{" "}
                    <strong>−{Math.max(1, Math.round(t.attack.damage * (1 - shieldPct / 100)))} PV</strong> au lieu de{" "}
                    {t.attack.damage}.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="font-display text-3xl uppercase">{s.them.name} choisit son bouclier…</p>
                <p className="mt-1 text-muted">La question part juste après.</p>
              </>
            )}
            {busy && <p className="mt-3 text-sm text-muted">Préparation de la question…</p>}
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            {t.question ? (
              <QuestionBlock
                turn={t}
                canAnswer={youDefend && s.phase === "question"}
                pending={pendingChoice}
                onAnswer={onAnswer}
              />
            ) : null}
            {s.phase === "question" && !youDefend && (
              <p className="mt-3 text-sm text-muted">{s.them.name} réfléchit…</p>
            )}
            {s.phase === "reveal" && t.outcome && <Outcome s={s} turn={t} />}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="infobox relative min-h-56 overflow-hidden p-4 sm:p-6" aria-live="polite">
      {/* Chaque phase entre en fondu, l'ancienne disparaît aussitôt : pas d'animation de sortie à attendre
          (des changements de phase rapprochés pouvaient bloquer l'ancienne phase à l'écran). */}
      <motion.div
        key={intro ? "intro" : key}
        initial={{ opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      >
        {body}
      </motion.div>
    </section>
  );
}

function Hand({
  cards,
  mode,
  selected,
  onSelect,
  title,
}: {
  cards: BattleCardView[];
  mode: "attack" | "shield" | null;
  selected: number | null;
  onSelect?: (slot: number) => void;
  title: string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 font-display text-lg uppercase text-muted">{title}</h2>
      {/* Téléphone : main défilante (les vignettes restent lisibles) ; écran large : les 5 côte à côte. */}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 pt-3 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0">
        {cards.map((c) => (
          <div key={c.slot} className="w-[7.5rem] shrink-0 snap-start sm:w-auto">
            <HandCard
              card={c}
              mode={mode}
              selected={selected === c.slot}
              onSelect={onSelect ? () => onSelect(c.slot) : undefined}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function TheirHand({ s }: { s: BattleStateDTO }) {
  return (
    <section aria-label={`Deck de ${s.them.name}`}>
      <h2 className="mb-2 font-display text-lg uppercase text-muted">Deck de {s.them.name}</h2>
      <div className="grid max-w-xl grid-cols-5 gap-2 sm:gap-3">
        {s.theirHand.map((c) => (
          <div key={c.slot} className="flex flex-col gap-1">
            <div className={c.attacked && c.shielded ? "opacity-45" : ""}>
              {c.card ? <Card card={c.card} href={null} /> : <CardBackMini card={c} />}
            </div>
            <CardStats card={c} compact />
          </div>
        ))}
      </div>
    </section>
  );
}

function Result({ s }: { s: BattleStateDTO }) {
  const r = s.result!;
  const title = r.outcome === "win" ? "Victoire" : r.outcome === "loss" ? "Défaite" : "Match nul";
  const why =
    r.forfeitBy === "them"
      ? `${s.them.name} a abandonné.`
      : r.forfeitBy === "you"
        ? "Tu as abandonné."
        : s.legacy
          ? "Duel de l’ancien format."
          : `${Math.max(0, s.you.hp ?? 0)} PV contre ${Math.max(0, s.them.hp ?? 0)}.`;
  return (
    <motion.section
      initial={{ opacity: 0, transform: "translateY(8px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className="infobox p-6 text-center"
      role="status"
    >
      <p
        className={`font-display text-6xl uppercase leading-none ${r.outcome === "win" ? "text-good" : r.outcome === "loss" ? "text-danger" : ""}`}
      >
        {title}
      </p>
      <p className="mt-2 text-lg">{why}</p>
      <p className="tnum mt-1 flex flex-wrap justify-center gap-x-4 text-sm text-muted">
        {r.eloDelta !== null && (
          <span className={r.eloDelta > 0 ? "text-good" : r.eloDelta < 0 ? "text-danger" : ""}>
            Elo {r.eloDelta >= 0 ? "+" : ""}
            {r.eloDelta}
          </span>
        )}
        <span>{r.reward !== null ? `+${r.reward} PW` : "Pas de PW pour ce duel"}</span>
      </p>
      <Link href="/battle" className="btn btn-primary mt-5">
        <Swords aria-hidden className="size-4" /> Nouveau duel
      </Link>
    </motion.section>
  );
}

export default function BattleScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const battleId = Number(id);
  const { snap, error, mutate, accept } = useBattle(battleId);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<number | null>(null);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const s = snap?.state;
  const stepKey = s ? `${s.turn}:${s.phase}:${s.status}` : "";

  // Nouvelle phase : on repart d'une sélection vide.
  const [shownStep, setShownStep] = useState(stepKey);
  if (shownStep !== stepKey) {
    setShownStep(stepKey);
    setSelected(null);
    setPendingChoice(null);
    setBusy(false);
  }

  // Bruitages : carte posée, question, issue du tour (bonne nouvelle ou non pour moi), fin du duel.
  const sounded = useRef("");
  useEffect(() => {
    if (!s || sounded.current === stepKey) return;
    const first = sounded.current === "";
    sounded.current = stepKey;
    if (first) return; // ouvrir un duel en cours ou fini reste silencieux
    if (s.status === "finished" && s.result) {
      play(s.result.outcome === "win" ? "victory" : s.result.outcome === "loss" ? "defeat" : "correct", 400);
    } else if (s.phase === "shield") play("deal");
    else if (s.phase === "question") play("flip");
    else if (s.phase === "reveal" && s.current?.outcome) {
      const o = s.current.outcome;
      const youDefend = s.current.defenderId === s.you.id;
      const good = youDefend ? o.parry !== "none" : o.parry === "none";
      play(good ? "correct" : "wrong");
    }
  }, [s, stepKey]);

  const youAttack = s?.attackerId === s?.you.id;
  const mode: "attack" | "shield" | null =
    s?.status === "active" && s.phase === "attack" && youAttack
      ? "attack"
      : s?.status === "active" && s.phase === "shield" && !youAttack
        ? "shield"
        : null;
  const selectedCard = useMemo(() => s?.myHand.find((c) => c.slot === selected) ?? null, [s, selected]);

  async function act(path: string, body: unknown) {
    setBusy(true);
    try {
      accept(await api<BattleStateDTO>(`/battles/${battleId}/${path}`, { body }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
      void mutate();
      setBusy(false);
      setPendingChoice(null);
    }
  }

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!s) return <div className="h-96 animate-pulse rounded-xl bg-panel" aria-busy />;

  if (s.status === "pending" || s.status === "declined" || s.status === "cancelled") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="page-title">Duel contre {s.them.name}</h1>
        <p className="text-muted">
          {s.status === "pending"
            ? s.isChallenger
              ? `En attente de la réponse de ${s.them.name}.`
              : "Ce défi t’attend sur la page Bataille."
            : s.status === "declined"
              ? "Défi refusé."
              : "Ce duel n’a pas eu lieu (annulé ou personne n’est venu à temps)."}{" "}
          <Link href="/battle" className="article-link">
            Retour aux duels
          </Link>
        </p>
      </div>
    );
  }

  const finished = s.status === "finished";
  const actionLabel =
    mode === "attack"
      ? selectedCard
        ? `Attaquer · ${selectedCard.damage} dégâts`
        : "Choisis une carte"
      : mode === "shield"
        ? selectedCard
          ? `Se protéger · −${pct(selectedCard.shieldPct)}`
          : "Choisis un bouclier"
        : "";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="page-title">Duel</h1>
        {!finished &&
          (confirmForfeit ? (
            <span className="flex items-center gap-2 text-sm">
              {s.phase === "lobby" ? "Annuler le duel ?" : "Abandonner ? Le duel sera perdu."}
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => {
                  setConfirmForfeit(false);
                  void act("forfeit", {});
                }}
              >
                Oui
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmForfeit(false)}>
                Non
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost text-muted" onClick={() => setConfirmForfeit(true)}>
              <Flag aria-hidden className="size-4" /> {s.phase === "lobby" ? "Annuler" : "Abandonner"}
            </button>
          ))}
      </header>

      {!s.legacy && <Scoreboard s={s} endsAt={snap.endsAt} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {finished ? (
            <Result s={s} />
          ) : (
            <Arena
              s={s}
              endsAt={snap.endsAt}
              selected={selectedCard}
              busy={busy}
              pendingChoice={pendingChoice}
              onAnswer={(i) => {
                setPendingChoice(i);
                void act("answer", { choice: i });
              }}
            />
          )}

          {s.myHand.length > 0 && (
            <div className="flex flex-col gap-3">
              <Hand
                cards={s.myHand}
                mode={mode}
                selected={selected}
                onSelect={mode ? setSelected : undefined}
                title={finished ? "Ton deck" : "Ta main"}
              />
              {mode && (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="text-xs text-faint">
                    {mode === "attack"
                      ? "Sans choix à la fin du chrono, une carte est jouée au hasard."
                      : "Sans choix à la fin du chrono, un bouclier est pris au hasard."}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary min-w-56"
                    disabled={!selectedCard || busy}
                    onClick={() => selectedCard && void act(mode, { slot: selectedCard.slot })}
                  >
                    {mode === "attack" ? (
                      <Swords aria-hidden className="size-4" />
                    ) : (
                      <Shield aria-hidden className="size-4" />
                    )}
                    {busy ? "Envoi…" : actionLabel}
                  </button>
                </div>
              )}
            </div>
          )}

          {s.theirHand.length > 0 && <TheirHand s={s} />}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Journal du duel">
          <div className="infobox">
            <h2 className="infobox-head">Journal</h2>
            {s.turns.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">
                {s.legacy ? "Pas de détail pour les duels de l’ancien format." : "Les tours joués s’affichent ici."}
              </p>
            ) : (
              <ol className="divide-y divide-dashed divide-line px-3">
                {[...s.turns].reverse().map((t) => (
                  <TurnLine key={t.turn} t={t} youId={s.you.id} theirName={s.them.name} />
                ))}
              </ol>
            )}
          </div>
          {!finished && (
            <p className="mt-3 px-1 text-xs leading-relaxed text-faint">
              Victoire {ECONOMY.battle.win} PW, défaite {ECONOMY.battle.loss} PW. Trois actions manquées d’affilée
              valent abandon.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
