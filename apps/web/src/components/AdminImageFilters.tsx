// Admin : filtres d'images (suggestion n° 111). Ajouter ou retirer une carte d'un thème à la main ; la liste
// l'emporte toujours sur la détection (catégories Wikipédia, résumé). Importé uniquement par des composants client.
import { IMAGE_THEME_LABELS, IMAGE_THEMES, type ImageTheme } from "@palacards/game";
import type { ImageFilterOverrideDTO } from "@palacards/shared";
import { RefreshCw, Search, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError, thumbSrc } from "@/lib/api";
import { fmt, relative } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";

interface Found {
  cardId: number;
  title: string;
  thumbUrl: string | null;
  themes: ImageTheme[];
}

function Mini({ thumbUrl, title }: { thumbUrl: string | null; title: string }) {
  return (
    <span className="relative block size-10 shrink-0 overflow-hidden rounded-md bg-panel-2">
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- vignette Wikimedia relayée par l'API (page Admin : jamais floutée)
        <img src={thumbSrc(thumbUrl)} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center font-display text-lg uppercase text-faint">
          {title.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

export function AdminImageFilters() {
  const list = useSWR<{ overrides: ImageFilterOverrideDTO[]; categoryCounts: Record<ImageTheme, number> }>(
    "/admin/image-filters",
  );
  const [q, setQ] = useState("");
  const query = useDebounced(q).trim();
  const found = useSWR<Found[]>(query ? `/admin/image-filters/search?q=${encodeURIComponent(query)}` : null);
  const [busy, setBusy] = useState(false);

  async function set(cardId: number, theme: ImageTheme, flagged: boolean | null, label: string) {
    setBusy(true);
    try {
      await api("/admin/image-filters", { method: "PUT", body: { cardId, theme, flagged } });
      toast.success(label);
      await Promise.all([list.mutate(), found.mutate()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Modification impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    try {
      const res = await api<{ started: boolean }>("/admin/image-filters/refresh", { method: "POST" });
      toast(
        res.started ? "Rechargement des catégories lancé (quelques minutes)." : "Un rechargement est déjà en cours.",
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Rechargement impossible.");
    }
  }

  const manual = (cardId: number, theme: ImageTheme) =>
    list.data?.overrides.find((o) => o.cardId === cardId && o.theme === theme);

  return (
    <section aria-labelledby="image-filters-title">
      <h2 id="image-filters-title" className="section-title mt-0">
        Filtres d’images
      </h2>
      <p className="hatnote mb-3">
        Images floutées pour les joueurs qui l’ont choisi. Détection : catégories Wikipédia (rechargées chaque lundi) et
        résumé de l’article. Ta liste l’emporte toujours : une carte ajoutée est floutée, une carte retirée ne l’est
        jamais.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        {list.data &&
          (["gore", "nudity"] as const).map((t) => (
            <span key={t} className="tnum">
              {IMAGE_THEME_LABELS[t]} : <strong className="text-text">{fmt(list.data!.categoryCounts[t])}</strong>{" "}
              articles par catégorie
            </span>
          ))}
        <button type="button" className="btn btn-sm" onClick={refresh}>
          <RefreshCw aria-hidden className="size-4" />
          Recharger les catégories
        </button>
      </div>

      <div className="relative max-w-md">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Titre ou identifiant de l’article"
          aria-label="Chercher une carte à classer"
          className="field h-9 min-h-0 pl-8 text-sm"
        />
      </div>
      {query && (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-panel" aria-label="Cartes trouvées">
          {found.error ? (
            <li className="p-3">
              <ErrorBox error={found.error} retry={() => found.mutate()} />
            </li>
          ) : !found.data ? (
            <li className="h-14 animate-pulse" />
          ) : found.data.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted">Aucune carte trouvée.</li>
          ) : (
            found.data.map((c) => (
              <li key={c.cardId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Mini thumbUrl={c.thumbUrl} title={c.title} />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block font-semibold">{c.title}</span>
                  <span className="text-xs text-faint">
                    {c.themes.length ? c.themes.map((t) => IMAGE_THEME_LABELS[t]).join(", ") : "Aucun thème"}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5" role="group" aria-label={`Thèmes de ${c.title}`}>
                  {IMAGE_THEMES.map((t) => {
                    const on = c.themes.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        className="chip"
                        aria-pressed={on}
                        disabled={busy}
                        title={manual(c.cardId, t) ? "Choix manuel (cliquer pour l’inverser)" : "Détection automatique"}
                        onClick={() =>
                          set(
                            c.cardId,
                            t,
                            !on,
                            on
                              ? `« ${c.title} » retirée : ${IMAGE_THEME_LABELS[t]}.`
                              : `« ${c.title} » ajoutée : ${IMAGE_THEME_LABELS[t]}.`,
                          )
                        }
                      >
                        {IMAGE_THEME_LABELS[t]}
                      </button>
                    );
                  })}
                </span>
              </li>
            ))
          )}
        </ul>
      )}

      <h3 className="mb-2 mt-5 text-sm font-semibold text-muted">Ta liste</h3>
      {list.error ? (
        <ErrorBox error={list.error} retry={() => list.mutate()} />
      ) : !list.data ? (
        <div className="h-24 animate-pulse rounded-xl bg-panel" />
      ) : list.data.overrides.length === 0 ? (
        <Empty title="Liste vide">Cherche une carte pour l’ajouter à un thème ou l’en retirer.</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
          {list.data.overrides.map((o) => (
            <li key={`${o.cardId}-${o.theme}`} className="flex items-center gap-3 px-3 py-2">
              <Mini thumbUrl={o.thumbUrl} title={o.title} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{o.title}</span>
                <span className="text-xs text-faint">
                  <span className={o.flagged ? "font-semibold text-warn" : "font-semibold text-good"}>
                    {o.flagged ? "Ajoutée" : "Retirée"}
                  </span>{" "}
                  · {IMAGE_THEME_LABELS[o.theme]} · {relative(o.createdAt)}
                  {o.by && ` · ${o.by}`}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => set(o.cardId, o.theme, null, `« ${o.title} » rendue à la détection automatique.`)}
              >
                <Undo2 aria-hidden className="size-4" />
                Détection auto
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
