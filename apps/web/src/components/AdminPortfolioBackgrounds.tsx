// Admin : images de fond des portfolios (suggestions n° 3 et 116). Les joueurs les envoient comme leurs bannières ;
// un admin peut en retirer une (le portfolio revient au fond Papier). Importé uniquement par des composants client.
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { portfolioBackgroundSrc } from "@/components/Portfolio";
import { ConfirmDialog, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { relative } from "@/lib/format";

interface Row {
  portfolioId: number;
  name: string;
  owner: { username: string; displayName: string };
  version: string;
  updatedAt: string;
}

export function AdminPortfolioBackgrounds() {
  const { data, error, mutate } = useSWR<Row[]>("/admin/portfolio-backgrounds");
  const [target, setTarget] = useState<Row | null>(null);

  async function remove(row: Row) {
    setTarget(null);
    try {
      await api(`/admin/portfolio-backgrounds/${row.portfolioId}`, { method: "DELETE" });
      toast.success("Image retirée.");
      void mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Suppression impossible.");
    }
  }

  return (
    <section>
      <h2 className="section-title mt-0">Images de fond des portfolios</h2>
      <p className="mb-3 text-sm text-muted">
        Les plus récentes d’abord. Retirer une image remet le fond Papier ; le joueur peut en envoyer une autre.
      </p>
      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="h-32 animate-pulse rounded-xl bg-panel" />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted">Aucune image envoyée.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((row) => (
            <li key={row.portfolioId} className="overflow-hidden rounded-xl border border-line bg-panel">
              {/* eslint-disable-next-line @next/next/no-img-element -- image envoyée par un joueur, servie par l'API */}
              <img
                src={portfolioBackgroundSrc(row.portfolioId, row.version)}
                alt={`Fond du portfolio ${row.name}`}
                loading="lazy"
                className="aspect-[16/10] w-full bg-panel-2 object-cover"
              />
              <div className="flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1 text-sm">
                  <Link href={`/portfolios/${row.portfolioId}`} className="article-link block truncate font-semibold">
                    {row.name}
                  </Link>
                  <span className="text-xs text-faint">
                    {row.owner.displayName} · {relative(row.updatedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost px-2 text-danger"
                  aria-label={`Retirer l’image de ${row.name}`}
                  onClick={() => setTarget(row)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!target}
        danger
        title="Retirer cette image ?"
        confirmLabel="Retirer"
        onConfirm={() => target && remove(target)}
        onClose={() => setTarget(null)}
      >
        Le portfolio de {target?.owner.displayName} reviendra au fond Papier.
      </ConfirmDialog>
    </section>
  );
}
