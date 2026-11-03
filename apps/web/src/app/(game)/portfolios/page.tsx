"use client";

import {
  PORTFOLIO_CARDS_MAX,
  PORTFOLIO_DESCRIPTION_MAX,
  PORTFOLIO_MAX,
  PORTFOLIO_NAME_MAX,
  PORTFOLIO_SHARED_MAX_PLAYERS,
} from "@palacards/game";
import type { Page, PortfolioSummaryDTO } from "@palacards/shared";
import { Plus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { InvitationAnswer, PortfolioRow, PortfolioShell, PortfolioTile } from "@/components/Portfolio";
import { Empty, ErrorBox, LoadMore } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSeenFeature } from "@/lib/features";
import { useMe } from "@/lib/game";

const SORTS = [
  { value: "recent", param: null, label: "Récents" },
  { value: "likes", param: "aimes", label: "Les plus aimés" },
] as const;

const TILES = "grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 2xl:grid-cols-3";

/** Nom et description d'un nouveau portfolio ; on file ensuite dans l'éditeur pour les cartes et le design. */
function CreatePortfolioDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await api<{ id: number }>("/portfolios", { body: { name: name.trim(), description } });
      router.push(`/portfolios/${id}/modifier`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Portfolio non créé.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="pf-new-title"
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-pop backdrop:bg-black/60"
    >
      {open && (
        <form onSubmit={submit} className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <h2 id="pf-new-title" className="flex-1 font-display text-2xl uppercase">
              Nouveau portfolio
            </h2>
            <button type="button" className="btn btn-sm btn-ghost px-2" onClick={onClose} aria-label="Fermer">
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Nom
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={PORTFOLIO_NAME_MAX}
              placeholder="Mes plus belles légendaires"
              required
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            <span>
              Description <span className="font-normal text-faint">(facultative)</span>
            </span>
            <textarea
              className="field min-h-24 py-2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={PORTFOLIO_DESCRIPTION_MAX}
              placeholder="Ce qui relie ces cartes, l'histoire derrière…"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              Créer et choisir les cartes
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** Ses propres portfolios (y compris ceux encore vides, visibles de soi seul). */
function Mine({ onCreate }: { onCreate: () => void }) {
  const { data, error, mutate } = useSWR<PortfolioSummaryDTO[]>("/portfolios/mine");
  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!data) return <div className="h-48 animate-pulse rounded-xl bg-panel" aria-busy />;
  if (!data.length)
    return (
      <Empty title="Pas encore de portfolio">
        Rassemble jusqu’à {PORTFOLIO_CARDS_MAX} cartes autour d’un thème, mets-en une en vedette et habille la page.{" "}
        <button type="button" className="article-link" onClick={onCreate}>
          Créer mon premier portfolio
        </button>
      </Empty>
    );
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((p) => (
          <li key={p.id}>
            <PortfolioRow p={p} />
          </li>
        ))}
      </ul>
      {data.length >= PORTFOLIO_MAX && (
        <p className="text-sm text-muted">
          Tu as atteint les {PORTFOLIO_MAX} portfolios : supprime-en un pour en créer un autre.
        </p>
      )}
    </div>
  );
}

/** Invitations d'amis dans leurs portfolios partagés (rien s'il n'y en a pas). */
function Invitations() {
  const { me } = useMe();
  const { data, mutate } = useSWR<PortfolioSummaryDTO[]>("/portfolios/invitations");
  const { mutate: refresh } = useSWRConfig();
  if (!data?.length || !me) return null;
  return (
    <section aria-labelledby="pf-invites-title" className="flex flex-col gap-4">
      <h2 id="pf-invites-title" className="section-title !mb-0 mt-0">
        Invitations
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((p) => (
          <li key={p.id}>
            <PortfolioShell id={p.id} design={p.design} pageClassName="flex flex-col gap-2.5 !p-4">
              <div className="min-w-0">
                <p className="pf-title truncate font-display text-xl">{p.name}</p>
                <p className="pf-muted mt-0.5 text-sm [text-wrap:pretty]">
                  {p.owner.displayName} t’invite à y ajouter tes cartes.{" "}
                  <Link href={`/portfolios/${p.id}`} className="pf-link font-semibold">
                    Voir la page
                  </Link>
                </p>
              </div>
              <InvitationAnswer
                p={p}
                me={me.username}
                onDone={() => {
                  void mutate();
                  void refresh("/portfolios/mine");
                }}
              />
            </PortfolioShell>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Community() {
  const router = useRouter();
  const params = useSearchParams();
  const sort = SORTS.find((s) => s.param && s.param === params.get("tri")) ?? SORTS[0];
  const list = useSWRInfinite<Page<PortfolioSummaryDTO>>((i, prev) =>
    prev && !prev.nextCursor ? null : `/portfolios?sort=${sort.value}&page=${i}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((s) => s + 1);
  }, [list]);

  return (
    <section aria-labelledby="pf-community-title" className="flex flex-col gap-4">
      <h2 id="pf-community-title" className="section-title !mb-0 mt-0">
        Ceux de la communauté
      </h2>
      <nav aria-label="Tri des portfolios" className="flex gap-1 border-b border-line">
        {SORTS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-current={sort.value === s.value ? "page" : undefined}
            onClick={() => router.replace(s.param ? `/portfolios?tri=${s.param}` : "/portfolios", { scroll: false })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors duration-150 ${sort.value === s.value ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {list.error ? (
        <ErrorBox error={list.error} retry={() => list.mutate()} />
      ) : !list.data ? (
        <div className={TILES}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-[18px] bg-panel" aria-hidden />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty title="Aucun portfolio pour l’instant">
          Un portfolio apparaît ici dès qu’il contient une carte. Le tien peut être le premier.
        </Empty>
      ) : (
        <>
          <ul className={TILES}>
            {items.map((p) => (
              <li key={p.id}>
                <PortfolioTile p={p} />
              </li>
            ))}
          </ul>
          <LoadMore onVisible={loadMore} loading={list.isValidating} done={done} />
        </>
      )}
    </section>
  );
}

export default function PortfoliosPage() {
  useSeenFeature("portfolios");
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="page-title">Portfolios</h1>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
          <Plus aria-hidden className="size-4" /> Nouveau portfolio
        </button>
      </div>
      <p className="hatnote -mt-4">
        Des pages de classeur composées avec tes cartes : jusqu’à {PORTFOLIO_CARDS_MAX} par portfolio, une en vedette,
        et un fond, un cadre et une couleur au choix. Invite jusqu’à {PORTFOLIO_SHARED_MAX_PLAYERS - 1} amis à y ajouter
        leurs cartes. Les j’aime ne rapportent rien, ils font juste plaisir.
      </p>

      <Invitations />

      <section aria-labelledby="pf-mine-title" className="flex flex-col gap-4">
        <h2 id="pf-mine-title" className="section-title !mb-0 mt-0">
          Tes portfolios
        </h2>
        <Mine onCreate={() => setCreating(true)} />
      </section>

      <Suspense>
        <Community />
      </Suspense>

      <CreatePortfolioDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
