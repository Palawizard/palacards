"use client";

import { BOSS_QUESTION_LABELS, CATEGORY_LABELS, RARITY_LABELS, type BossQuestionType } from "@palacards/game";
import type {
  ArticleCategoryKey,
  BossCardDTO,
  BossCardsDTO,
  BossDTO,
  BossHitDTO,
  BossLiveDTO,
} from "@palacards/shared";
import { BookOpen, Check, Crown, Moon, Shield, Sword, Swords, X, Zap } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { CardBack } from "@/components/Battle";
import { Card } from "@/components/Card";
import { CardImage } from "@/components/CardImage";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError, thumbSrc } from "@/lib/api";
import { fmt, timeLeft } from "@/lib/format";
import { useSeenFeature } from "@/lib/features";
import { useMe, useSocketEvent } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";
import "@/components/content.css";

type BossState = BossDTO & { receivedAt: number };
const withTime = (b: BossDTO): BossState => ({ ...b, receivedAt: Date.now() });
const fetchBoss = (path: string) => api<BossDTO>(path).then(withTime);

const RULES_KEY = "pc-boss-rules-v2";
const mult = (m: number) => `×${String(m).replace(".", ",")}`;
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const label = (type: string) => BOSS_QUESTION_LABELS[type as BossQuestionType] ?? "Question";

/** Repère de la règle du jour sur une carte : faiblesse (×2) ou résistance (×0,5). */
function CategoryTag({ category, m }: { category: ArticleCategoryKey; m: number }) {
  const tone = m > 1 ? "weak" : m < 1 ? "resist" : undefined;
  return (
    <span className="pc-cat" data-tone={tone}>
      {tone === "weak" ? (
        <Zap className="size-3" aria-hidden />
      ) : tone === "resist" ? (
        <Shield className="size-3" aria-hidden />
      ) : null}
      {CATEGORY_LABELS[category]}
      {tone && <span className="tnum">{mult(m)}</span>}
      {tone && <span className="sr-only">{tone === "weak" ? " (faiblesse du boss)" : " (résistance du boss)"}</span>}
    </span>
  );
}

/** Règles, dépliées à la première visite. */
function Rules({ boss }: { boss: BossDTO }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    try {
      if (!localStorage.getItem(RULES_KEY)) {
        if (ref.current) ref.current.open = true;
        localStorage.setItem(RULES_KEY, "1");
      }
    } catch {
      // stockage indisponible : règles repliées
    }
  }, []);
  const [p1, p2] = boss.rewards.phases;
  return (
    <details ref={ref} className="pc-boss-rules">
      <summary>
        <BookOpen className="size-4" aria-hidden />
        Règles du boss
      </summary>
      <ul>
        <li>
          Le boss ne meurt plus : quand une <strong>phase</strong> tombe, la suivante arrive aussitôt avec 40 % de PV en
          plus. Le combat dure jusqu&apos;à minuit.
        </li>
        <li>
          Chaque jour, une catégorie d&apos;article est sa <strong>faiblesse</strong> ({mult(boss.rule.weaknessMult)}{" "}
          dégâts) et une autre sa <strong>résistance</strong> ({mult(boss.rule.resistanceMult)}).
        </li>
        <li>
          Un article joué contre le boss se <strong>repose {boss.fatigueDays} jours</strong> : varie tes cartes.
        </li>
        <li>
          Questions : définition et image (×1,5 en moins de 4 s), année à taper (×1,5 exacte, ×1 à 2 ans près, ×0,5 à 10
          ans, ×0,25 à 25 ans), duel contre le boss ({mult(0.75)}, sans critique). Jamais deux fois la même question sur
          un article.
        </li>
        <li>
          À minuit, chaque phase tombée paie ceux qui ont infligé au moins {fmt(boss.rewards.minDamage)} dégâts dans la
          journée : {fmt(p1!.pw)} PW et {p1!.packs} paquet pour la phase 1, {fmt(p2!.pw)} PW et {p2!.packs} paquet pour
          la 2, {fmt(boss.rewards.laterPhase.pw)} PW pour chacune des suivantes. Le meilleur assaillant gagne{" "}
          {boss.rewards.mvpPacks} paquet de plus ; les autres qui ont touché le boss, {fmt(boss.rewards.consolationPw)}{" "}
          PW de consolation.
        </li>
      </ul>
    </details>
  );
}

/** Phases : tombées (cochées), en cours, à venir. */
function PhaseTrack({ boss }: { boss: BossDTO }) {
  return (
    <ol className="pc-phase-track" aria-label="Phases du boss">
      {boss.phases.map((p) => (
        <li
          key={p.phase}
          data-state={p.fallenAt ? "down" : "current"}
          title={
            p.fallenAt
              ? `Phase ${p.phase} tombée à ${new Date(p.fallenAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${p.fallenBy ? `, coup de ${p.fallenBy}` : ""}`
              : `Phase ${p.phase} en cours : ${fmt(p.maxHp)} PV`
          }
        >
          {p.fallenAt ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
          <span>Phase {p.phase}</span>
          {p.fallenAt && <span className="sr-only"> tombée</span>}
        </li>
      ))}
      <li data-state="next" aria-hidden>
        Phase {boss.phase + 1}
      </li>
    </ol>
  );
}

/** Jauge de la phase en cours : un coup la fait tressauter, une phase qui tombe la fait éclater puis la remplit. */
function Gauge({
  boss,
  hit,
  fall,
}: {
  boss: BossDTO;
  hit: { key: number; damage: number; name: string } | null;
  fall: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hit) return;
    el.removeAttribute("data-hit");
    void el.offsetWidth;
    el.setAttribute("data-hit", "");
  }, [hit]);
  return (
    <div className="relative">
      <div
        ref={ref}
        key={`phase-${boss.phase}`}
        className="pc-boss-gauge"
        data-fall={fall > 0 || undefined}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={boss.maxHp}
        aria-valuenow={boss.hp}
        aria-label={`Points de vie de la phase ${boss.phase}`}
      >
        <div className="pc-boss-hp" style={{ transform: `scaleX(${boss.hp / boss.maxHp})` }} />
        <div className="pc-boss-hp-label tnum">
          <span>
            {fmt(boss.hp)}
            <span className="text-[0.55em] opacity-80"> / {fmt(boss.maxHp)} PV</span>
          </span>
          <span className="hidden text-[0.6em] sm:inline">Phase {boss.phase}</span>
        </div>
      </div>
      {hit && (
        <span key={hit.key} className="pc-boss-pop tnum" aria-hidden>
          −{fmt(hit.damage)}
          <span className="ml-1.5 font-sans text-xs font-semibold text-cover-ink [font-stretch:100%]">{hit.name}</span>
        </span>
      )}
    </div>
  );
}

/** Ce que le joueur a déjà acquis aujourd'hui, versé à minuit. */
function Earned({ boss }: { boss: BossDTO }) {
  const e = boss.earned;
  const fallen = boss.phases.filter((p) => p.fallenAt).length;
  let text: string;
  if (!boss.myDamage) text = "Lance un assaut : chaque phase tombée paie ceux qui ont tapé assez fort.";
  else if (e.phases.length)
    text = `Acquis : ${fmt(e.pw)} PW${e.packs ? ` et ${e.packs} ${plural(e.packs, "paquet", "paquets")}` : ""} pour ${e.phases.length} ${plural(e.phases.length, "phase tombée", "phases tombées")}.`;
  else if (e.missing > 0 && fallen > 0)
    text = `Encore ${fmt(e.missing)} dégâts pour toucher ${plural(fallen, "la phase tombée", `les ${fallen} phases tombées`)}. En attendant : ${fmt(e.pw)} PW de consolation.`;
  else if (e.missing > 0) text = `Encore ${fmt(e.missing)} dégâts pour toucher les phases qui tomberont aujourd'hui.`;
  else if (fallen === 0)
    text = `Seuil atteint : chaque phase qui tombe d'ici minuit te paiera. Sinon, ${fmt(e.pw)} PW de consolation.`;
  else text = "Rien de plus à toucher pour l'instant : fais tomber la phase suivante !";
  return (
    <p className="pc-boss-earned" data-done={e.phases.length > 0 || undefined} role="status">
      <Moon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        {text}
        {e.mvp && (
          <span className="block text-muted">
            <Crown className="mr-1 inline size-3.5 align-[-0.1rem] text-warn" aria-hidden />
            Tu mènes : {boss.rewards.mvpPacks} paquet en plus si tu restes en tête à minuit.
          </span>
        )}
        <span className="block text-xs text-faint">Versé à minuit.</span>
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Choix des cinq articles
// ---------------------------------------------------------------------------

/** Vignette d'un article : image, rareté, dégâts du jour (ou repos restant). */
function CardTile({
  c,
  on,
  disabled,
  onToggle,
}: {
  c: BossCardDTO;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const tired = c.restDays > 0;
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        disabled={tired || (disabled && !on)}
        onClick={onToggle}
        className="pc-boss-tile"
        data-tired={tired || undefined}
        title={tired ? undefined : `${fmt(c.critDamage)} dégâts en critique`}
      >
        <span className="pc-boss-thumb" data-rarity={c.rarity}>
          {c.thumbUrl ? (
            <CardImage cardId={c.cardId} src={thumbSrc(c.thumbUrl)} revealable={false} />
          ) : (
            <span className="font-display text-3xl uppercase text-faint" aria-hidden>
              {c.title.slice(0, 1)}
            </span>
          )}
          <span className="pc-sigil pc-boss-tile-rarity" title={RARITY_LABELS[c.rarity]}>
            {c.rarity}
            <span className="sr-only"> ({RARITY_LABELS[c.rarity]})</span>
          </span>
          {c.shiny && (
            <span className="pc-shiny-tag pc-boss-tile-shiny" title="Carte brillante">
              Brillante
            </span>
          )}
          <span className="pc-boss-check" aria-hidden>
            {on && <Check className="size-3.5" strokeWidth={3} />}
          </span>
        </span>
        <span className="line-clamp-2 text-[0.8rem] font-semibold leading-tight">{c.title}</span>
        <span className="mt-auto flex flex-col items-start gap-1 text-xs">
          {tired ? (
            <span className="text-faint">
              Reposée dans {c.restDays} {plural(c.restDays, "jour", "jours")}
            </span>
          ) : (
            <span className="tnum text-muted">{fmt(c.damage)} dégâts</span>
          )}
          <CategoryTag category={c.category} m={c.mult} />
        </span>
      </button>
    </li>
  );
}

function CardPicker({ boss, onStart }: { boss: BossDTO; onStart: (ids: number[]) => Promise<boolean> }) {
  const { data, error, mutate } = useSWR<BossCardsDTO>("/boss/cards");
  const [picked, setPicked] = useState<number[]>([]);
  const [onlyWeak, setOnlyWeak] = useState(false);
  const [busy, setBusy] = useState(false);
  const need = boss.cardsPerAssault;
  const items = data?.items ?? [];
  const ready = items.filter((c) => c.restDays === 0);
  const shown = onlyWeak ? ready.filter((c) => c.mult > 1) : items;
  const weakCount = ready.filter((c) => c.mult > 1).length;
  const byId = new Map(items.map((c) => [c.instanceId, c]));
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < need ? [...p, id] : p));
  const total = picked.reduce((s, id) => s + (byId.get(id)?.damage ?? 0), 0);

  async function start(ids: number[]) {
    setBusy(true);
    try {
      if (await onStart(ids)) setPicked([]);
      void mutate();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!data) return <div className="h-64 animate-pulse rounded-xl bg-panel" aria-label="Chargement de tes cartes" />;
  if (data.available < need)
    return (
      <Empty title="Pas assez d'articles reposés">
        {data.total < need
          ? `Il te faut ${need} articles différents pour lancer un assaut. Ouvre quelques paquets !`
          : `Il te faut ${need} articles différents prêts à jouer : tu n'en as que ${data.available}, les autres se reposent après un assaut (${boss.fatigueDays} jours). Ouvre des paquets pour en avoir d'autres.`}
      </Empty>
    );
  return (
    <div className="flex flex-col gap-4">
      <ol className="pc-boss-slots" aria-label="Ton assaut">
        {Array.from({ length: need }, (_, i) => {
          const c = picked[i] ? byId.get(picked[i]) : undefined;
          return (
            <li key={i} data-filled={!!c || undefined}>
              {c ? (
                <button type="button" onClick={() => toggle(c.instanceId)} aria-label={`Retirer ${c.title}`}>
                  <span className="line-clamp-2 text-left text-sm font-semibold leading-tight">{c.title}</span>
                  <span className="tnum text-xs text-muted">{fmt(c.damage)} dégâts</span>
                  <X className="pc-boss-slot-x size-3.5" aria-hidden />
                </button>
              ) : (
                <span className="text-xs text-faint">Carte {i + 1}</span>
              )}
            </li>
          );
        })}
      </ol>
      {/* Boutons au-dessus des vignettes : toujours à portée, la grille défile en dessous. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="tnum text-sm text-muted">
          {fmt(data.available)} {plural(data.available, "article prêt", "articles prêts")}
          {picked.length > 0 && ` · jusqu'à ${fmt(total)} dégâts`}
        </p>
        <div className="flex w-full gap-2 sm:w-auto">
          <button
            type="button"
            className="btn btn-sm flex-1 sm:flex-none"
            disabled={busy}
            onClick={() => setPicked(ready.slice(0, need).map((c) => c.instanceId))}
          >
            Mes {need} plus efficaces
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary flex-1 sm:flex-none"
            disabled={busy || picked.length !== need}
            onClick={() => void start(picked)}
          >
            <Sword className="size-4" aria-hidden />
            {busy ? "Préparation…" : `Attaquer (${picked.length}/${need})`}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer">
          <button type="button" className="chip" aria-pressed={!onlyWeak} onClick={() => setOnlyWeak(false)}>
            Toutes
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={onlyWeak}
            onClick={() => setOnlyWeak(true)}
            disabled={!weakCount}
          >
            <Zap className="size-3.5" aria-hidden />
            Efficaces aujourd&apos;hui ({weakCount})
          </button>
        </div>
        {shown.length === 0 ? (
          <p className="slot px-4 py-6 text-center text-sm text-muted">
            Aucun article {CATEGORY_LABELS[boss.rule.weakness].toLowerCase()} prêt aujourd&apos;hui.
          </p>
        ) : (
          <div className="pc-boss-scroll" tabIndex={0} role="region" aria-label="Tes articles">
            <ul className="pc-boss-grid">
              {shown.map((c) => (
                <CardTile
                  key={c.instanceId}
                  c={c}
                  on={picked.includes(c.instanceId)}
                  disabled={picked.length >= need}
                  onToggle={() => toggle(c.instanceId)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assaut en cours
// ---------------------------------------------------------------------------

function verdict(h: BossHitDTO): string {
  if (h.hit === "crit") return h.type === "year_input" ? "Année exacte !" : "Coup critique !";
  if (h.hit === "hit") return h.type === "year_input" && h.guessYear !== h.correctYear ? "Pas loin !" : "Touché !";
  if (h.choice === null && h.guessYear === null) return "Trop tard";
  return "Raté";
}

function HitDetail({ h, choices }: { h: BossHitDTO; choices: string[] | null }) {
  if (h.type === "year_input")
    return (
      <p className="tnum text-muted">
        C&apos;était {h.correctYear}
        {h.guessYear !== null && h.guessYear !== h.correctYear && ` (tu as dit ${h.guessYear})`}.{" "}
        {h.damage > 0 && `${h.card.title} inflige ${fmt(h.damage)} dégâts.`}
      </p>
    );
  const right =
    h.correctIndex !== null && choices && !choices[h.correctIndex]?.startsWith("http") ? choices[h.correctIndex] : null;
  return (
    <p className="tnum text-muted">
      {h.damage > 0
        ? `${h.card.title} inflige ${fmt(h.damage)} dégâts.`
        : right
          ? `La bonne réponse : ${right}.`
          : "Aucun dégât."}
    </p>
  );
}

function YearInput({ disabled, onSubmit }: { disabled: boolean; onSubmit: (year: number) => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const year = /^-?\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : null;
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (year !== null && !disabled) onSubmit(year);
      }}
    >
      <label htmlFor="boss-year" className="sr-only">
        Ton année
      </label>
      <input
        id="boss-year"
        ref={ref}
        className="field tnum h-12 max-w-[10rem] text-center text-xl"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Année"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, "").slice(0, 5))}
        disabled={disabled}
        enterKeyHint="send"
      />
      <button type="submit" className="btn btn-primary h-12 px-5" disabled={disabled || year === null}>
        Valider
      </button>
    </form>
  );
}

function AssaultPanel({
  boss,
  onAnswer,
  onNext,
  lastChoices,
}: {
  boss: BossState;
  onAnswer: (answer: { choice: number } | { year: number }) => void;
  onNext: () => void;
  lastChoices: string[] | null;
}) {
  const a = boss.current!;
  const q = a.question;
  const last = a.hits.at(-1);
  const now = useNow(200);
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
    const t = setTimeout(onNext, last.type === "year_input" || last.hit === "miss" ? 2_400 : 1_700);
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
            <li key={h.idx} className="pc-boss-recap" data-hit={h.hit}>
              <span className="min-w-0 flex-1 truncate font-semibold sm:w-full">{h.card.title}</span>
              <span className="text-xs text-faint">{label(h.type)}</span>
              <span className="tnum inline-flex items-center gap-1">
                {h.hit === "crit" ? (
                  <Zap className="size-3.5" aria-hidden />
                ) : h.hit === "hit" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <X className="size-3.5" aria-hidden />
                )}
                {h.hit === "miss" ? "Raté" : `−${fmt(h.damage)}`}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (!q) {
    if (!last)
      return <div className="h-40 animate-pulse rounded-xl bg-panel" aria-label="Préparation de la question" />;
    return (
      <div className="pc-boss-verdict" data-hit={last.hit} aria-live="polite">
        <p className="font-display text-4xl uppercase">{verdict(last)}</p>
        <HitDetail h={last} choices={lastChoices} />
        {last.mult !== 1 && last.damage > 0 && (
          <p className="text-sm text-muted">
            <CategoryTag category={last.category} m={last.mult} /> compris
          </p>
        )}
      </div>
    );
  }

  const late = remaining < 4_000;
  const duel = q.type === "duel_older" || q.type === "duel_popular";
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
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
          <span className="font-display text-lg uppercase">
            {duel && <Swords className="mr-1.5 inline size-4 align-[-0.1rem]" aria-hidden />}
            {label(q.type)} · {q.idx + 1}/{boss.cardsPerAssault}
          </span>
          <CategoryTag category={q.category} m={q.mult} />
        </div>
        <div className="duel-clock" data-late={late} aria-hidden>
          <span style={{ transform: `scaleX(${remaining / q.durationMs})` }} />
        </div>
        <p className="leading-relaxed [text-wrap:pretty]">{q.prompt}</p>
        {q.input === "year" ? (
          <YearInput key={q.idx} disabled={expired} onSubmit={(year) => onAnswer({ year })} />
        ) : (
          <div className={`grid gap-2 ${q.type === "image" ? "grid-cols-2" : duel ? "grid-cols-2" : "sm:grid-cols-2"}`}>
            {q.choices.map((c, i) => (
              <button
                key={i}
                type="button"
                className="btn h-auto min-h-12 justify-start whitespace-normal py-2.5 text-left"
                disabled={expired}
                onClick={() => onAnswer({ choice: i })}
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
        )}
        <p className="text-xs text-faint">
          {q.input === "year"
            ? "Exacte : ×1,5 · à 2 ans : ×1 · à 10 ans : ×0,5 · à 25 ans : ×0,25"
            : duel
              ? "Duel à deux choix : ×0,75, sans critique."
              : "En moins de 4 s : coup critique (×1,5)."}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BossPage() {
  useSeenFeature("boss-v2");
  const { mutateMe } = useMe();
  const reduce = useReducedMotion();
  const { data, error, mutate } = useSWR<BossState>("/boss", fetchBoss);
  const [hit, setHit] = useState<{ key: number; damage: number; name: string } | null>(null);
  const [fell, setFell] = useState<{ key: number; phase: number; by: string } | null>(null);
  const [answering, setAnswering] = useState(false);
  const [lastChoices, setLastChoices] = useState<string[] | null>(null);
  const now = useNow(30_000);

  // Annonce de chute : quelques secondes, puis elle s'efface.
  useEffect(() => {
    if (!fell) return;
    const t = setTimeout(() => setFell(null), 4_000);
    return () => clearTimeout(t);
  }, [fell]);

  useSocketEvent("boss:update", (b: BossLiveDTO) => {
    if (!data || b.day !== data.day) return;
    if (b.last && b.last.damage > 0) setHit({ key: Date.now(), damage: b.last.damage, name: b.last.name });
    const down = b.fell.at(-1);
    if (down) {
      setFell({ key: Date.now(), phase: down.phase, by: down.by });
      play("victory");
    }
    void mutate((d) => (d ? { ...d, phase: b.phase, hp: b.hp, maxHp: b.maxHp, totalDamage: b.totalDamage } : d), {
      revalidate: !!down,
    });
  });

  async function start(ids: number[]): Promise<boolean> {
    try {
      await mutate(withTime(await api<BossDTO>("/boss/assault", { body: { instanceIds: ids } })), {
        revalidate: false,
      });
      play("deal");
      void mutateMe();
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de lancer l'assaut.");
      return false;
    }
  }

  async function answer(a: { choice: number } | { year: number }) {
    const q = data?.current?.question;
    if (!data?.current || !q || answering) return;
    setAnswering(true);
    setLastChoices(q.choices);
    try {
      const res = withTime(
        await api<BossDTO>(`/boss/assault/${data.current.id}/answer`, { body: { idx: q.idx, ...a } }),
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
          Une Légendaire à faire tomber ensemble, phase après phase, jusqu&apos;à minuit. Deux assauts par jour, cinq
          articles chacun ; joue sa faiblesse.
        </p>
      </div>

      {!data ? (
        <div className="h-80 animate-pulse rounded-xl bg-panel" aria-label="Chargement du boss" />
      ) : (
        <>
          <Rules boss={data} />
          <section
            aria-label="Le boss"
            className="relative grid gap-5 overflow-hidden rounded-[18px] border border-line bg-panel p-4 shadow-lift sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:p-5"
          >
            <div className="mx-auto w-44 sm:w-full">
              <Card card={data.boss} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <h2 className="font-display text-[2rem] uppercase leading-[0.95] [text-wrap:balance] sm:text-[2.6rem]">
                  {data.boss.title}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {fmt(data.participants)} {plural(data.participants, "assaillant", "assaillants")} aujourd&apos;hui ·{" "}
                  {fmt(data.totalDamage)} dégâts en tout · fin dans {timeLeft(new Date(data.nextAt).getTime() - now)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Règle du jour">
                <span className="pc-rule" data-tone="weak">
                  <Zap className="size-4" aria-hidden />
                  Faiblesse : {CATEGORY_LABELS[data.rule.weakness]}{" "}
                  <span className="tnum">{mult(data.rule.weaknessMult)}</span>
                </span>
                <span className="pc-rule" data-tone="resist">
                  <Shield className="size-4" aria-hidden />
                  Résistance : {CATEGORY_LABELS[data.rule.resistance]}{" "}
                  <span className="tnum">{mult(data.rule.resistanceMult)}</span>
                </span>
              </div>
              <PhaseTrack boss={data} />
              <Gauge boss={data} hit={hit} fall={fell?.key ?? 0} />
              {data.ranking.length > 0 && (
                <ol className="tnum flex flex-wrap gap-x-4 gap-y-1.5 text-sm" aria-label="Classement des assaillants">
                  {data.ranking.slice(0, 8).map((r, i) => (
                    <li key={r.userId} className={r.me ? "font-semibold text-text" : "text-muted"}>
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
              <Earned boss={data} />
            </div>
            {fell && (
              <div key={fell.key} className="pc-phase-fall" data-reduce={reduce || undefined} role="status">
                <p className="font-display text-4xl uppercase sm:text-5xl">Phase {fell.phase} tombée !</p>
                <p className="text-sm font-semibold">
                  Coup de {fell.by}. La phase {fell.phase + 1} arrive, plus solide.
                </p>
              </div>
            )}
          </section>

          <section aria-labelledby="assault-title" className="infobox">
            <h2 id="assault-title" className="infobox-head flex flex-wrap items-baseline justify-between gap-2">
              <span>{running ? `Assaut ${data.current!.number}` : "Ton assaut"}</span>
              <span className="tnum font-sans text-sm font-semibold normal-case text-muted [font-stretch:100%]">
                {fmt(data.myDamage)} dégâts aujourd&apos;hui · {left}{" "}
                {plural(left, "assaut restant", "assauts restants")}
              </span>
            </h2>
            <div className="p-4">
              {running ? (
                <AssaultPanel
                  boss={data}
                  onAnswer={(a) => void answer(a)}
                  onNext={() => void next()}
                  lastChoices={lastChoices}
                />
              ) : (
                <div className="flex flex-col gap-6">
                  {data.current?.finished && (
                    <AssaultPanel boss={data} onAnswer={() => {}} onNext={() => {}} lastChoices={null} />
                  )}
                  {left > 0 ? (
                    <CardPicker boss={data} onStart={start} />
                  ) : (
                    <Empty title="Plus d'assaut aujourd'hui">
                      Un nouveau boss arrive dans {timeLeft(new Date(data.nextAt).getTime() - now)}. Tes gains du jour
                      tombent à minuit.
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
