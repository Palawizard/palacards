// Portfolios (suggestions n° 3 et 116) : page de classeur décorée (fond, cadre, accent), aperçu en liste et like.
// Importé uniquement par des composants client.
import { PORTFOLIO_PROFILE_SLOTS } from "@palacards/game";
import type { PortfolioDesignDTO, PortfolioDTO, PortfolioSummaryDTO } from "@palacards/shared";
import { Check, ChevronLeft, ChevronRight, Heart, Link2, Lock, Pencil, Star, Users, X } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { Card } from "@/components/Card";
import { api, API_BASE, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import "./portfolio.css";

/** Image de fond envoyée par le joueur (servie par l'API, versionnée pour le cache). */
export const portfolioBackgroundSrc = (id: number, version: string) =>
  `${API_BASE}/portfolios/${id}/background?v=${encodeURIComponent(version)}`;

/** Page de classeur : cadre (bord), fond (matière de la page) et accent. */
export function PortfolioShell({
  id,
  design,
  children,
  className = "",
  pageClassName = "",
}: {
  id: number;
  design: PortfolioDesignDTO;
  children: ReactNode;
  className?: string;
  pageClassName?: string;
}) {
  const image =
    design.background === "image" && design.backgroundVersion
      ? ({ "--pf-image": `url("${portfolioBackgroundSrc(id, design.backgroundVersion)}")` } as CSSProperties)
      : undefined;
  return (
    <div className={`pf ${className}`} data-frame={design.frame} data-accent={design.accent}>
      <div className={`pf-page ${pageClassName}`} data-bg={design.background} style={image}>
        {children}
      </div>
    </div>
  );
}

const likesLabel = (n: number) => `${fmt(n)} j’aime`;

/** Le visiteur compose ce portfolio (propriétaire ou ami qui l'a rejoint). */
export const participates = (p: PortfolioSummaryDTO) => p.role === "owner" || p.role === "member";

const joinNames = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names.at(-1)}` : (names[0] ?? "");

/** Ceux qui composent le portfolio : « Léa », « Léa et Max », « Léa, Max et Sam ». */
export const participantsLabel = (p: PortfolioSummaryDTO) =>
  joinNames([p.owner, ...p.members].map((m) => m.displayName));

/** Amis qui participent au portfolio (sans le propriétaire). */
const sharedWith = (p: PortfolioSummaryDTO) => joinNames(p.members.map((m) => m.displayName));

/** J'aime (sans récompense) : un par joueur, jamais sur les siens ; le compteur suit tout de suite. */
export function LikeButton({
  p,
  onChange,
}: {
  p: PortfolioSummaryDTO;
  onChange?: (likes: number, liked: boolean) => void;
}) {
  const [state, setState] = useState({ likes: p.likes, liked: p.liked, for: p.id });
  const [busy, setBusy] = useState(false);
  // Nouveau portfolio affiché : on repart de ses valeurs.
  if (state.for !== p.id) setState({ likes: p.likes, liked: p.liked, for: p.id });
  if (participates(p))
    return (
      <span className="pf-like" title="Tu ne peux pas aimer un portfolio que tu composes">
        <Heart aria-hidden className="size-4" strokeWidth={2.25} />
        <span className="tnum">{fmt(state.likes)}</span>
        <span className="sr-only">j’aime</span>
      </span>
    );
  async function toggle() {
    const liked = !state.liked;
    const before = state;
    setState({ ...state, liked, likes: state.likes + (liked ? 1 : -1) });
    setBusy(true);
    try {
      const res = await api<{ likes: number; liked: boolean }>(`/portfolios/${p.id}/like`, {
        method: liked ? "POST" : "DELETE",
      });
      setState((s) => ({ ...s, likes: res.likes, liked: res.liked }));
      onChange?.(res.likes, res.liked);
    } catch (err) {
      setState(before);
      toast.error(err instanceof ApiError ? err.message : "J’aime non enregistré.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className="pf-like relative z-[1]"
      aria-pressed={state.liked}
      aria-label={`${state.liked ? "Retirer ton j’aime" : "J’aime"} (${likesLabel(state.likes)})`}
      disabled={busy}
      onClick={toggle}
    >
      <Heart aria-hidden className="size-4" strokeWidth={2.25} />
      <span className="tnum">{fmt(state.likes)}</span>
    </button>
  );
}

/** Aperçu en liste (page Portfolios, profil) : la page entière mène au portfolio, le j'aime reste cliquable. */
export function PortfolioTile({ p, heading: Heading = "h3" }: { p: PortfolioSummaryDTO; heading?: "h2" | "h3" }) {
  return (
    <article className="relative">
      <PortfolioShell id={p.id} design={p.design} pageClassName="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Heading className="pf-title font-display text-[1.6rem] sm:text-[1.8rem]">
              <Link
                href={`/portfolios/${p.id}`}
                className="after:absolute after:inset-0 after:rounded-[18px] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-[var(--color-focus)]"
              >
                {p.name}
              </Link>
            </Heading>
            <p className="pf-muted mt-1 flex items-center gap-1.5 text-sm">
              <span className="pf-rule !w-5" aria-hidden />
              <span className="truncate">
                {participantsLabel(p)} · {p.cardCount} carte{p.cardCount > 1 ? "s" : ""}
              </span>
            </p>
          </div>
          <LikeButton p={p} />
        </div>
        {p.preview.length > 0 ? (
          <div className="pf-strip" aria-hidden>
            {p.preview.map((c) => (
              <Card key={c.instanceId} card={c} href={null} prefetch={false} />
            ))}
          </div>
        ) : (
          <p className="pf-muted py-6 text-center text-sm">Pas encore de carte.</p>
        )}
      </PortfolioShell>
    </article>
  );
}

/** Copie le lien public du portfolio. */
function ShareButton({ id }: { id: number }) {
  async function share() {
    const url = `${window.location.origin}${window.location.pathname.replace(/\/portfolios\/.*$/, "")}/portfolios/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Lien copié.");
    } catch {
      toast(url);
    }
  }
  return (
    <button type="button" className="btn btn-sm" onClick={share}>
      <Link2 aria-hidden className="size-4" /> Copier le lien
    </button>
  );
}

/** Page complète d'un portfolio : en-tête dans la page, toutes les cartes, la vedette en grand. */
export function PortfolioView({ p }: { p: PortfolioDTO }) {
  return (
    <PortfolioShell id={p.id} design={p.design} pageClassName="flex flex-col gap-4 sm:gap-5">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="pf-title font-display text-[clamp(2.1rem,1.4rem+2.6vw,3.6rem)]">{p.name}</h1>
          <span className="pf-rule mt-2.5" aria-hidden />
          <p className="pf-muted mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {/* Propriétaire puis amis participants : « Léa, Max et Sam ». */}
            {[p.owner, ...p.members].map((m, i, all) => (
              <span key={m.username} className="inline-flex items-center">
                <Link href={`/u/${m.username}`} className="pf-link inline-flex items-center gap-1.5 font-semibold">
                  <Avatar name={m.displayName} avatar={m.avatar} size="sm" />
                  {m.displayName}
                </Link>
                {i < all.length - 2 ? "," : i === all.length - 2 ? <span className="ml-2">et</span> : null}
              </span>
            ))}
            <span aria-hidden>·</span>
            <span className="tnum">
              {p.cardCount} carte{p.cardCount > 1 ? "s" : ""}
            </span>
            {p.visibility === "members" && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Lock aria-hidden className="size-3.5" /> Visible des participants seuls
                </span>
              </>
            )}
          </p>
          {p.description && <p className="mt-2 max-w-[65ch] [text-wrap:pretty]">{p.description}</p>}
        </div>
        <LikeButton p={p} />
      </header>
      {p.cards.length ? (
        <ol className="pf-grid" aria-label={`Cartes de ${p.name}`}>
          {p.cards.map((c) => (
            <li key={c.instanceId} className={c.featured ? "pf-featured" : undefined}>
              <Card card={c} />
              {c.featured && (
                <span className="sr-only">
                  <Star aria-hidden /> Carte en vedette
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="pf-muted py-10 text-center">Ce portfolio n’a pas encore de carte.</p>
      )}
    </PortfolioShell>
  );
}

/** Actions sous la page d'un portfolio : partager, et modifier si on le compose. */
export function PortfolioActions({ p }: { p: PortfolioSummaryDTO }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ShareButton id={p.id} />
      {participates(p) && (
        <Link href={`/portfolios/${p.id}/modifier`} className="btn btn-sm btn-primary">
          <Pencil aria-hidden className="size-4" /> {p.mine ? "Modifier" : "Mes cartes"}
        </Link>
      )}
    </div>
  );
}

/** Réponse à l'invitation d'un ami dans son portfolio partagé : rejoindre ou refuser. */
export function InvitationAnswer({
  p,
  me,
  onDone,
}: {
  p: PortfolioSummaryDTO;
  me: string;
  onDone: (joined: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function answer(join: boolean) {
    setBusy(true);
    try {
      if (join) await api(`/portfolios/${p.id}/join`, { method: "POST" });
      else await api(`/portfolios/${p.id}/members/${encodeURIComponent(me)}`, { method: "DELETE" });
      toast.success(join ? `Tu participes à « ${p.name} ».` : "Invitation refusée.");
      onDone(join);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Réponse non enregistrée.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => answer(true)}>
        <Check aria-hidden className="size-4" /> Rejoindre
      </button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => answer(false)}>
        Refuser
      </button>
    </div>
  );
}

/** Ligne compacte de ses propres portfolios : la page en petit, trois cartes en éventail et les actions. */
export function PortfolioRow({ p }: { p: PortfolioSummaryDTO }) {
  return (
    <PortfolioShell id={p.id} design={p.design} pageClassName="flex items-center gap-3 !p-3">
      <div className="pf-fan" aria-hidden>
        {p.preview.slice(0, 3).map((c) => (
          <Card key={c.instanceId} card={c} href={null} prefetch={false} />
        ))}
        {p.preview.length === 0 && <span className="pf-fan-empty" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="pf-title truncate font-display text-xl">{p.name}</p>
        <p className="pf-muted tnum mt-0.5 text-sm">
          {p.cardCount
            ? `${p.cardCount} carte${p.cardCount > 1 ? "s" : ""}`
            : p.members.length
              ? "Vide"
              : "Vide, visible de toi seul"}{" "}
          · {likesLabel(p.likes)}
          {p.mine && p.profileSlot !== null && " · sur ton profil"}
        </p>
        {(!p.mine || p.members.length > 0) && (
          <p className="pf-muted mt-0.5 flex items-center gap-1 truncate text-sm">
            <Users aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{p.mine ? `Avec ${sharedWith(p)}` : `Partagé par ${p.owner.displayName}`}</span>
          </p>
        )}
        <p className="mt-1.5 flex gap-3 text-sm font-semibold">
          <Link href={`/portfolios/${p.id}/modifier`} className="pf-link">
            {p.mine ? "Modifier" : "Mes cartes"}
          </Link>
          {p.cardCount > 0 && (
            <Link href={`/portfolios/${p.id}`} className="pf-link">
              Voir la page
            </Link>
          )}
        </p>
      </div>
    </PortfolioShell>
  );
}

const PROFILE_GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";

/** Portfolios du profil d'un autre joueur (3 au plus, dans son ordre) ; rien s'il n'en montre aucun. */
export function TheirPortfolios({ username }: { username: string }) {
  const { data } = useSWR<PortfolioSummaryDTO[]>(`/players/${encodeURIComponent(username)}/portfolios`);
  if (!data?.length) return null;
  return (
    <section aria-labelledby="profile-pf-title">
      <h2 id="profile-pf-title" className="section-title mt-0">
        Portfolios
      </h2>
      <ul className={PROFILE_GRID}>
        {data.map((p) => (
          <li key={p.id}>
            <PortfolioTile p={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Son propre profil : choix et ordre des portfolios affichés (3 au plus). */
export function MyProfilePortfolios() {
  const { data, mutate } = useSWR<PortfolioSummaryDTO[]>("/portfolios/mine");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  // Seulement les siens (pas ceux d'amis auxquels on participe), publics pour en ajouter.
  const own = data.filter((p) => p.mine);
  const shown = own.filter((p) => p.profileSlot !== null);
  const others = own.filter((p) => p.profileSlot === null && p.cardCount > 0 && p.visibility === "public");

  async function save(ids: number[]) {
    setBusy(true);
    try {
      await api("/portfolios/profile", { method: "PUT", body: { ids } });
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Profil non enregistré.");
    } finally {
      setBusy(false);
    }
  }
  const ids = shown.map((p) => p.id);
  const swap = (i: number, j: number) => {
    const next = [...ids];
    [next[i], next[j]] = [next[j]!, next[i]!];
    void save(next);
  };

  return (
    <section aria-labelledby="profile-pf-title">
      <div className="mb-[0.9rem] flex items-center gap-3">
        <h2 id="profile-pf-title" className="section-title my-0 flex-1">
          Portfolios
          <span className="tnum font-sans text-sm font-semibold normal-case tracking-normal text-faint [font-stretch:100%]">
            {shown.length} / {PORTFOLIO_PROFILE_SLOTS}
          </span>
        </h2>
        {own.length > 0 && (
          <button
            type="button"
            className={`btn btn-sm ${editing ? "btn-primary" : ""}`}
            aria-pressed={editing}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Terminé" : "Choisir"}
          </button>
        )}
      </div>
      {!own.length ? (
        <p className="text-sm text-muted">
          Compose un portfolio avec tes cartes pour l’afficher ici.{" "}
          <Link href="/portfolios" className="article-link">
            Créer un portfolio
          </Link>
        </p>
      ) : !shown.length && !editing ? (
        <p className="text-sm text-muted">
          Aucun portfolio sur ton profil. Touche « Choisir » pour en afficher jusqu’à {PORTFOLIO_PROFILE_SLOTS}.
        </p>
      ) : (
        <ul className={PROFILE_GRID}>
          {shown.map((p, i) => (
            <li key={p.id} className="flex flex-col gap-2">
              <PortfolioTile p={p} />
              {!p.cardCount && <p className="text-sm text-muted">Vide : les autres ne le voient pas.</p>}
              {editing && (
                <div className="pc-arrange-bar" role="group" aria-label={`Place de ${p.name}`}>
                  <button
                    type="button"
                    className="pc-arrange-btn"
                    aria-label={`Avancer ${p.name}`}
                    disabled={busy || i === 0}
                    onClick={() => swap(i, i - 1)}
                  >
                    <ChevronLeft aria-hidden className="size-4" />
                  </button>
                  <span className="tnum px-1 text-xs font-bold text-muted">{i + 1}</span>
                  <button
                    type="button"
                    className="pc-arrange-btn"
                    aria-label={`Reculer ${p.name}`}
                    disabled={busy || i === shown.length - 1}
                    onClick={() => swap(i, i + 1)}
                  >
                    <ChevronRight aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="pc-arrange-btn pc-arrange-remove ml-auto"
                    aria-label={`Retirer ${p.name} du profil`}
                    disabled={busy}
                    onClick={() => save(ids.filter((id) => id !== p.id))}
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
          {editing && shown.length < PORTFOLIO_PROFILE_SLOTS && (
            <li className="slot flex flex-col justify-center gap-3 rounded-[18px] p-5">
              {others.length ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const id = Number(adding || others[0]!.id);
                    void save([...ids, id]);
                    setAdding("");
                  }}
                >
                  <label className="label" htmlFor="profile-pf-add">
                    Ajouter au profil
                  </label>
                  <select
                    id="profile-pf-add"
                    className="field"
                    value={adding || String(others[0]!.id)}
                    onChange={(e) => setAdding(e.target.value)}
                  >
                    {others.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn btn-sm self-start" disabled={busy}>
                    Ajouter
                  </button>
                </form>
              ) : (
                <p className="text-sm text-muted">
                  Tous tes portfolios avec des cartes sont déjà là.{" "}
                  <Link href="/portfolios" className="article-link">
                    En créer un autre
                  </Link>
                </p>
              )}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
