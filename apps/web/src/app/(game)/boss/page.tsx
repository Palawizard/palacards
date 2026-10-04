"use client";

import { bossDamage, bossHitBase, RARITY_LABELS } from "@palacards/game";
import type { BossDTO, BossLiveDTO, CardDTO, Page } from "@palacards/shared";
import { Check, Crown, Sword, Users, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { CardBack, questionLabel } from "@/components/Battle";
import { Card } from "@/components/Card";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError, thumbSrc } from "@/lib/api";
import { fmt, timeLeft } from "@/lib/format";
import { useSeenFeature } from "@/lib/features";
import { useMe, useSocketEvent } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";
import "@/components/content.css";

/**
 * Assaillants dans la jauge : des pastilles de papier d'album, en trois teintes de couverture alternées
 * (jamais les couleurs de rareté) ; le jaune pochette est réservé au joueur.
 */
const SEGMENTS = [
  "color-mix(in oklab, var(--color-sticker) 96%, var(--color-cover))",
  "color-mix(in oklab, var(--color-sticker) 80%, var(--color-cover))",
  "color-mix(in oklab, var(--color-sticker) 66%, var(--color-cover))",
];

/**
 * La jauge géante : PV restants en rouge à gauche ; à droite, les dégâts de chaque joueur empilés à sa
 * couleur (les tiens rayés), dans l'ordre du classement. Un coup reçu la fait tressauter.
 */
function Gauge({ boss, hit }: { boss: BossDTO; hit: { key: number; damage: number; name: string } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hit) return;
    el.removeAttribute("data-hit");
    void el.offsetWidth;
    el.setAttribute("data-hit", "");
  }, [hit]);
  // Les segments remplissent la part perdue de la jauge, au prorata des dégâts de chacun (les coups portés
  // après la chute restent à l'échelle).
  const dealtTotal = Math.max(
    1,
    boss.ranking.reduce((s, r) => s + r.damage, 0),
  );
  const lost = 1 - boss.hp / boss.maxHp;
  return (
    <div className="relative">
      <div
        ref={ref}
        className="pc-boss-gauge"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={boss.maxHp}
        aria-valuenow={boss.hp}
        aria-label="Points de vie du boss"
      >
        <div className="pc-boss-hp" style={{ transform: `scaleX(${boss.hp / boss.maxHp})` }} />
        <div className="pc-boss-dealt" aria-hidden>
          {[...boss.ranking].reverse().map((r) => {
            const i = boss.ranking.indexOf(r);
            const width = (r.damage / dealtTotal) * lost * 100;
            return (
              <span
                key={r.userId}
                data-me={r.me || undefined}
                title={`${r.name} : ${fmt(r.damage)} dégâts`}
                style={
                  {
                    width: `${width}%`,
                    "--seg": r.me ? "var(--color-accent)" : SEGMENTS[i % SEGMENTS.length],
                  } as React.CSSProperties
                }
              >
                {width >= 7 && (r.me ? "Toi" : r.name.slice(0, 1))}
              </span>
            );
          })}
        </div>
        <div className="pc-boss-hp-label tnum">
          <span>
            {fmt(boss.hp)}
            <span className="text-[0.55em] opacity-80"> / {fmt(boss.maxHp)} PV</span>
          </span>
          {boss.killedAt && <span className="text-accent">Vaincu</span>}
        </div>
      </div>
      {hit && (
        <span key={hit.key} className="pc-boss-pop tnum" aria-hidden>
          −{hit.damage}
          <span className="ml-1.5 font-sans text-xs font-semibold text-cover-ink [font-stretch:100%]">{hit.name}</span>
        </span>
      )}
    </div>
  );
}

/**
 * Boss tombé : les retardataires peuvent encore toucher la récompense en finissant un assaut (« renfort »),
 * et le paquet du meilleur assaillant n'est attribué qu'à minuit.
 */
function Reinforcement({ boss, left }: { boss: BossDTO; left: number }) {
  const { pw, packs } = boss.rewards.kill;
  const [title, body] = boss.rewarded
    ? [
        "Récompense touchée",
        `Tes assauts comptent encore pour la place de meilleur assaillant, désignée à minuit (${boss.rewards.mvpPacks} paquet bonus de plus).`,
      ]
    : left > 0
      ? [
          "Pas trop tard pour un renfort",
          `Finis un assaut avant minuit : tu touches toi aussi ${fmt(pw)} PW et ${packs} paquets bonus.`,
        ]
      : ["Renfort en cours", "Termine ton assaut pour toucher la récompense de la chute."];
  return (
    <div className="pc-boss-reinforce" data-rewarded={boss.rewarded || undefined} role="status">
      <Users className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p className="min-w-0 text-sm">
        <span className="block font-semibold text-text">{title}</span>
        <span className="text-muted">{body}</span>
      </p>
    </div>
  );
}

/** Choix des 5 cartes de l'assaut, parmi les plus fortes en ATK de la collection. */
function CardPicker({ boss, onStart }: { boss: BossDTO; onStart: (ids: number[]) => Promise<void> }) {
  const { data, error } = useSWR<Page<CardDTO>>("/collection?sort=atk&limit=18");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const cards = data?.items ?? [];
  const need = boss.cardsPerAssault;
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < need ? [...p, id] : p));
  async function start(ids: number[]) {
    setBusy(true);
    try {
      await onStart(ids);
      setPicked([]);
    } finally {
      setBusy(false);
    }
  }
  if (error) return <ErrorBox error={error} />;
  if (data && cards.length < need)
    return (
      <Empty title="Pas assez de cartes">
        Il te faut {need} cartes dans ta collection pour lancer un assaut. Ouvre quelques paquets !
      </Empty>
    );
  return (
    <div className="flex flex-col gap-4">
      {/* Sur téléphone, l'en-tête s'efface : la barre d'action passe sous la liste et y reste collée. */}
      <div className="contents sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        <p className="text-sm text-muted">
          Choisis {need} cartes : chacune frappe une fois si tu réponds juste à la question sur son article (
          <span className="tnum">40 + ATK ÷ 100</span> dégâts, ×1,5 en moins de 4 s).
        </p>
        {/* Sur téléphone, les boutons restent sous le pouce pendant qu'on fait défiler les cartes. */}
        <div className="sticky bottom-0 z-10 order-last -mx-4 flex w-[calc(100%+2rem)] gap-2 sm:order-none border-t border-line bg-panel/95 px-4 py-2.5 backdrop-blur-sm sm:static sm:mx-0 sm:w-auto sm:border-0 sm:bg-transparent sm:p-0">
          <button
            type="button"
            className="btn btn-sm flex-1 sm:flex-none"
            disabled={busy || cards.length < need}
            onClick={() => setPicked(cards.slice(0, need).map((c) => c.instanceId!))}
          >
            Mes {need} plus fortes
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary flex-1 sm:flex-none"
            disabled={busy || picked.length !== need}
            onClick={() => void start(picked)}
          >
            <Sword className="size-4" aria-hidden />
            Attaquer ({picked.length}/{need})
          </button>
        </div>
      </div>
      {!data ? (
        <div className="h-60 animate-pulse rounded-xl bg-panel" />
      ) : (
        <>
          {/* Téléphone : des lignes compactes (sigle, titre, ATK, dégâts) plutôt qu'un mur de vignettes. */}
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line sm:hidden">
            {cards.map((c) => {
              const on = picked.includes(c.instanceId!);
              return (
                <li key={c.instanceId}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(c.instanceId!)}
                    className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-150 ${on ? "bg-accent/15" : ""}`}
                  >
                    <span data-rarity={c.rarity} className="pc-sigil shrink-0">
                      {c.rarity}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <span className="truncate">{c.title}</span>
                        {c.shiny && (
                          <span className="pc-shiny-tag !static shrink-0 !text-[0.65rem]" title="Carte brillante">
                            Brillante
                          </span>
                        )}
                      </span>
                      <span className="tnum text-xs text-muted">
                        ATK {fmt(c.atk)} · {bossHitBase(c.atk)} dégâts, {bossDamage(c.atk, "crit")} en critique
                      </span>
                    </span>
                    <span
                      className={`grid size-6 shrink-0 place-items-center rounded-full border-2 ${on ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`}
                      aria-hidden
                    >
                      {on && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <ul className="hidden grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 sm:grid">
            {cards.map((c) => {
              const on = picked.includes(c.instanceId!);
              return (
                <li key={c.instanceId}>
                  <button
                    type="button"
                    className="pc-boss-pick flex w-full flex-col gap-1 rounded-[14px] text-left"
                    aria-pressed={on}
                    onClick={() => toggle(c.instanceId!)}
                    aria-label={`${c.title} : ${bossHitBase(c.atk)} dégâts`}
                  >
                    <Card card={c} href={null} />
                    <span className="tnum text-center text-xs text-muted">
                      {bossHitBase(c.atk)} dégâts · {bossDamage(c.atk, "crit")} en critique
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** Question en cours de l'assaut, avec son chrono ; puis le bilan du coup. */
type BossState = BossDTO & { receivedAt: number };
const withTime = (b: BossDTO): BossState => ({ ...b, receivedAt: Date.now() });
const fetchBoss = (path: string) => api<BossDTO>(path).then(withTime);

function AssaultPanel({
  boss,
  onAnswer,
  onNext,
}: {
  boss: BossState;
  onAnswer: (choice: number) => void;
  onNext: () => void;
}) {
  const a = boss.current!;
  const q = a.question;
  const last = a.hits.at(-1);
  const now = useNow(200);
  // Échéance de la question : temps restant au moment où l'état a été reçu.
  const remaining = q ? Math.max(0, boss.receivedAt + q.remainingMs - now) : 0;
  const expired = !!q && remaining <= 0;
  // Chrono écoulé : le serveur compte la question comme ratée et passe à la suivante.
  useEffect(() => {
    if (!expired) return;
    const t = setTimeout(onNext, 1_200);
    return () => clearTimeout(t);
  }, [expired, onNext]);
  // Bilan d'une question : affiché un instant, puis la suivante.
  useEffect(() => {
    if (q || a.finished || !last) return;
    const t = setTimeout(onNext, 1_700);
    return () => clearTimeout(t);
  }, [q, a.finished, last, onNext]);

  if (a.finished) {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-display text-2xl uppercase">
          Assaut {a.number} terminé : <span className="text-highlight tnum">{fmt(a.damage)} dégâts</span>
        </p>
        <ol className="grid gap-2 sm:grid-cols-5">
          {a.hits.map((h) => (
            <li
              key={h.idx}
              className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm sm:flex-col sm:items-start"
            >
              <span className="min-w-0 flex-1 truncate font-semibold sm:w-full">{h.card.title}</span>
              <span className={`tnum inline-flex items-center gap-1 ${h.hit === "miss" ? "text-danger" : "text-good"}`}>
                {h.hit === "crit" ? (
                  <Zap className="size-3.5" />
                ) : h.hit === "hit" ? (
                  <Check className="size-3.5" />
                ) : (
                  <X className="size-3.5" />
                )}
                {h.hit === "miss" ? "Raté" : `−${h.damage}`}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (!q) {
    if (!last) return <div className="h-40 animate-pulse rounded-xl bg-panel" />;
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center" aria-live="polite">
        <p className={`font-display text-4xl uppercase ${last.hit === "miss" ? "text-danger" : "text-good"}`}>
          {last.hit === "crit"
            ? "Coup critique !"
            : last.hit === "hit"
              ? "Touché !"
              : last.choice === null
                ? "Trop tard"
                : "Raté"}
        </p>
        <p className="tnum text-muted">
          {last.hit === "miss" ? "Aucun dégât." : `${last.card.title} inflige ${last.damage} dégâts.`}
        </p>
      </div>
    );
  }

  const late = remaining < 4_000;
  return (
    <div className="grid gap-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
      <div className="mx-auto w-36 sm:w-full">
        {q.cardHidden ? (
          <CardBack
            rarity={q.card.rarity}
            label={`Ta carte (${RARITY_LABELS[q.card.rarity].toLowerCase()}), face cachée jusqu'à ta réponse`}
          />
        ) : (
          <Card card={q.card} href={null} revealable />
        )}
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-display text-lg uppercase">
            {questionLabel(q.type)} · {q.idx + 1}/{boss.cardsPerAssault}
          </span>
          <span className="tnum text-muted">
            {bossHitBase(q.card.atk)} dégâts, {bossDamage(q.card.atk, "crit")} en moins de 4 s
          </span>
        </div>
        <div className="duel-clock" data-late={late} aria-hidden>
          <span style={{ transform: `scaleX(${remaining / q.durationMs})` }} />
        </div>
        <p className="leading-relaxed [text-wrap:pretty]">{q.prompt}</p>
        <div className={`grid gap-2 ${q.type === "image" ? "grid-cols-2" : "sm:grid-cols-2"}`}>
          {q.choices.map((c, i) => (
            <button
              key={i}
              type="button"
              className="btn h-auto min-h-12 justify-start whitespace-normal py-2.5 text-left"
              disabled={expired}
              onClick={() => onAnswer(i)}
            >
              {q.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- vignettes Wikimedia relayées par l'API
                <img src={thumbSrc(c)} alt={`Image ${i + 1}`} className="mx-auto max-h-28 rounded object-contain" />
              ) : (
                c
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BossPage() {
  useSeenFeature("boss");
  const { mutateMe } = useMe();
  const { data, error, mutate } = useSWR<BossState>("/boss", fetchBoss);
  const [hit, setHit] = useState<{ key: number; damage: number; name: string } | null>(null);
  const [answering, setAnswering] = useState(false);
  const now = useNow(30_000);

  useSocketEvent("boss:update", (b: BossLiveDTO) => {
    if (!data || b.day !== data.day) return;
    if (b.last && b.last.damage > 0) setHit({ key: Date.now(), damage: b.last.damage, name: b.last.name });
    if (b.killedAt && !data.killedAt) play("victory");
    void mutate((d) => (d ? { ...d, hp: b.hp, killedAt: b.killedAt } : d), { revalidate: true });
  });

  async function start(ids: number[]) {
    try {
      await mutate(withTime(await api<BossDTO>("/boss/assault", { body: { instanceIds: ids } })), {
        revalidate: false,
      });
      play("deal");
      void mutateMe();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de lancer l'assaut.");
    }
  }

  async function answer(choice: number) {
    const q = data?.current?.question;
    if (!data?.current || !q || answering) return;
    setAnswering(true);
    try {
      const res = withTime(
        await api<BossDTO>(`/boss/assault/${data.current.id}/answer`, { body: { idx: q.idx, choice } }),
      );
      const h = res.current?.hits.find((x) => x.idx === q.idx);
      play(h?.hit === "crit" ? "sr" : h?.hit === "hit" ? "correct" : "wrong");
      await mutate(res, { revalidate: false });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Réponse refusée.");
      void mutate();
    } finally {
      setAnswering(false);
    }
  }

  async function next() {
    if (!data?.current) return;
    try {
      const res = withTime(await api<BossDTO>(`/boss/assault/${data.current.id}/next`, { method: "POST" }));
      await mutate(res, { revalidate: false });
      if (res.current?.finished) void mutateMe();
    } catch {
      void mutate();
    }
  }

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  const running = !!data?.current && !data.current.finished;
  const left = data ? data.assaultsPerDay - data.assaultsUsed : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Boss du jour</h1>
        <p className="hatnote mt-2">
          Une Légendaire à abattre ensemble avant minuit, avec des PV à la mesure des assaillants habituels. Deux
          assauts par jour et par joueur ; s&apos;il tombe, chaque assaillant gagne{" "}
          {data
            ? `${fmt(data.rewards.kill.pw)} PW et ${data.rewards.kill.packs} paquets bonus`
            : "des PW et des paquets"}
          , même en renfort après la chute. Le meilleur de la journée, désigné à minuit, gagne un paquet de plus.
        </p>
      </div>

      {!data ? (
        <div className="h-80 animate-pulse rounded-xl bg-panel" />
      ) : (
        <>
          <section
            aria-label="Le boss"
            className="grid gap-5 rounded-[18px] border border-line bg-panel p-4 shadow-lift sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:p-5"
          >
            <div className={`mx-auto w-44 sm:w-full ${data.killedAt ? "pc-boss-dead" : ""}`}>
              <Card card={data.boss} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <h2 className="font-display text-[2rem] uppercase leading-[0.95] [text-wrap:balance] sm:text-[2.6rem]">
                  {data.boss.title}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {data.killedAt
                    ? `Vaincu${data.killedBy ? ` par ${data.killedBy}` : ""} à ${new Date(data.killedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. Bien joué la bande !`
                    : `${fmt(data.participants)} assaillant${data.participants > 1 ? "s" : ""} aujourd'hui. Il reste ${timeLeft(new Date(data.nextAt).getTime() - now)}.`}
                </p>
              </div>
              <Gauge boss={data} hit={hit} />
              {data.ranking.length > 0 && (
                <ol
                  className="pc-boss-legend tnum flex flex-wrap gap-x-4 gap-y-1.5 text-sm"
                  aria-label="Classement des assaillants"
                >
                  {data.ranking.map((r, i) => (
                    <li
                      key={r.userId}
                      className={r.me ? "font-semibold text-text" : "text-muted"}
                      style={
                        { "--seg": r.me ? "var(--color-accent)" : SEGMENTS[i % SEGMENTS.length] } as React.CSSProperties
                      }
                    >
                      {i === 0 && (
                        <Crown
                          className="mr-1 inline size-3.5 align-[-0.1rem] text-warn"
                          aria-label="En tête : un paquet bonus de plus à minuit"
                        />
                      )}
                      {r.me ? "Toi" : r.name} · {fmt(r.damage)}
                    </li>
                  ))}
                </ol>
              )}
              {data.killedAt && <Reinforcement boss={data} left={left} />}
            </div>
          </section>

          <section aria-labelledby="assault-title" className="infobox">
            <h2 id="assault-title" className="infobox-head flex flex-wrap items-baseline justify-between gap-2">
              <span>
                {running
                  ? `Assaut ${data.current!.number}`
                  : data.killedAt && !data.rewarded
                    ? "Ton renfort"
                    : "Ton assaut"}
              </span>
              <span className="tnum font-sans text-sm font-semibold normal-case text-muted [font-stretch:100%]">
                {fmt(data.myDamage)} dégâts aujourd&apos;hui · {left} assaut{left > 1 ? "s" : ""} restant
                {left > 1 ? "s" : ""}
              </span>
            </h2>
            <div className="p-4">
              {running ? (
                <AssaultPanel boss={data} onAnswer={(c) => void answer(c)} onNext={() => void next()} />
              ) : (
                <div className="flex flex-col gap-6">
                  {data.current?.finished && <AssaultPanel boss={data} onAnswer={() => {}} onNext={() => {}} />}
                  {left > 0 ? (
                    <CardPicker boss={data} onStart={start} />
                  ) : (
                    <Empty title="Plus d'assaut aujourd'hui">
                      Un nouveau boss arrive dans {timeLeft(new Date(data.nextAt).getTime() - now)}.
                    </Empty>
                  )}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
