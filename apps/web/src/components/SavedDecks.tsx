// Decks de bataille enregistrés (importé uniquement par des composants client) : charger, enregistrer,
// renommer, supprimer. Le deck chargé remplit le sélecteur ; le duel vérifie toujours les cartes envoyées.
import { DECK_SIZE, SAVED_DECK_NAME_MAX, SAVED_DECKS_MAX } from "@palacards/game";
import type { CardDTO, SavedDeckDTO } from "@palacards/shared";
import { Pencil, Save, Trash2, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { ConfirmDialog } from "./ui";

const ids = (cards: (CardDTO | null)[]) => cards.map((c) => c?.instanceId).join(",");

const cardsLabel = (n: number) => `${n} carte${n > 1 ? "s" : ""}`;

/** Le deck enregistré ne peut pas servir tel quel : ce qui manque, en clair. */
function deckProblem(d: SavedDeckDTO): string | null {
  if (d.status === "invalid") {
    return `${cardsLabel(d.missing)} ${d.missing > 1 ? "ne sont" : "n’est"} plus dans ta collection : remplace-${d.missing > 1 ? "les" : "la"}, puis enregistre le deck.`;
  }
  if (d.status === "incomplete") return `Deck incomplet (${d.cards.length}/${DECK_SIZE}) : ajoute des cartes.`;
  return null;
}

export function SavedDecks({ deck, onLoad }: { deck: CardDTO[]; onLoad: (d: CardDTO[]) => void }) {
  const { data, error, mutate } = useSWR<SavedDeckDTO[]>("/battles/decks");
  const [loadedId, setLoadedId] = useState<number | null>(null);
  /** Champ de nom ouvert : nouveau deck, ou renommage du deck chargé. */
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const decks = data ?? [];
  const loaded = decks.find((d) => d.id === loadedId) ?? null;
  const full = decks.length >= SAVED_DECKS_MAX;
  // Comparé aux cartes encore possédées : c'est ce que le chargement a mis dans le sélecteur.
  const changed = !!loaded && ids(loaded.cards.filter(Boolean)) !== ids(deck);
  const problem = loaded && !changed ? deckProblem(loaded) : null;
  /** Un deck à réparer peut aussi s'enregistrer tel quel (cartes perdues retirées). */
  const canSave = !!loaded && (changed || loaded.missing > 0);

  function load(d: SavedDeckDTO) {
    setLoadedId(d.id);
    setNaming(null);
    // Les cartes perdues laissent leur place libre : le joueur la remplit dans le sélecteur.
    onLoad(d.cards.filter((c): c is CardDTO => !!c));
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  function submitName(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (naming === "rename" && loaded) {
        const saved = await api<SavedDeckDTO>(`/battles/decks/${loaded.id}`, { method: "PUT", body: { name } });
        await mutate(
          decks.map((d) => (d.id === saved.id ? saved : d)),
          { revalidate: false },
        );
        toast.success("Deck renommé.");
      } else {
        const saved = await api<SavedDeckDTO>("/battles/decks", {
          body: { name, cards: deck.map((c) => c.instanceId) },
        });
        await mutate([...decks, saved], { revalidate: false });
        setLoadedId(saved.id);
        toast.success(`Deck « ${saved.name} » enregistré.`);
      }
      setNaming(null);
    }, "Enregistrement impossible.");
  }

  function saveChanges() {
    if (!loaded) return;
    void run(async () => {
      const saved = await api<SavedDeckDTO>(`/battles/decks/${loaded.id}`, {
        method: "PUT",
        body: { cards: deck.map((c) => c.instanceId) },
      });
      await mutate(
        decks.map((d) => (d.id === saved.id ? saved : d)),
        { revalidate: false },
      );
      toast.success(`Deck « ${saved.name} » mis à jour.`);
    }, "Enregistrement impossible.");
  }

  function remove() {
    if (!loaded) return;
    void run(async () => {
      await api(`/battles/decks/${loaded.id}`, { method: "DELETE" });
      await mutate(
        decks.filter((d) => d.id !== loaded.id),
        { revalidate: false },
      );
      setLoadedId(null);
      toast(`Deck « ${loaded.name} » supprimé.`);
    }, "Suppression impossible.");
  }

  function openNaming(mode: "new" | "rename") {
    setNaming(mode);
    setName(mode === "rename" && loaded ? loaded.name : "");
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted">
        Mes decks{" "}
        <span className="tnum text-faint">
          ({decks.length}/{SAVED_DECKS_MAX})
        </span>
      </h3>
      {error ? (
        <p className="text-sm text-danger">Impossible de charger tes decks.</p>
      ) : !data ? (
        <div className="h-8 w-64 max-w-full animate-pulse rounded-full bg-panel-2" />
      ) : decks.length === 0 ? (
        <p className="text-sm text-faint">
          Aucun deck enregistré : compose ta sélection, puis enregistre-la pour la retrouver au prochain duel.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Charger un deck enregistré">
          {decks.map((d) => (
            <button
              key={d.id}
              type="button"
              className="chip"
              aria-pressed={d.id === loadedId}
              onClick={() => load(d)}
              title={deckProblem(d) ?? "Deck prêt"}
            >
              {d.status === "invalid" && (
                <TriangleAlert aria-label="À réparer" className="size-3.5 shrink-0 text-warn" strokeWidth={2.5} />
              )}
              <span className="max-w-40 truncate">{d.name}</span>
              {d.status === "incomplete" && (
                <span className="tnum text-xs opacity-75">
                  {d.cards.length}/{DECK_SIZE}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {problem && (
        <p className="flex items-start gap-1.5 text-sm" role="status">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2.5} />
          <span>
            <strong className="font-semibold">« {loaded!.name} »</strong> : {problem}
          </span>
        </p>
      )}

      {naming ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={submitName}>
          <input
            className="field h-9 min-h-0 max-w-64 flex-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={SAVED_DECK_NAME_MAX}
            placeholder="Nom du deck"
            aria-label="Nom du deck"
            autoFocus
          />
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !name.trim()}>
            {naming === "rename" ? "Renommer" : "Enregistrer"}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNaming(null)}>
            Annuler
          </button>
        </form>
      ) : (
        data && (
          <div className="flex flex-wrap items-center gap-1.5">
            {loaded && (
              <>
                <button type="button" className="btn btn-sm" disabled={busy || !canSave} onClick={saveChanges}>
                  <Save aria-hidden className="size-4" /> Enregistrer « {loaded.name} »
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost px-2"
                  disabled={busy}
                  onClick={() => openNaming("rename")}
                  aria-label={`Renommer « ${loaded.name} »`}
                  title="Renommer"
                >
                  <Pencil aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost px-2"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                  aria-label={`Supprimer « ${loaded.name} »`}
                  title="Supprimer"
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy || full || deck.length === 0}
              onClick={() => openNaming("new")}
              title={full ? `${SAVED_DECKS_MAX} decks au plus : supprimes-en un d’abord.` : undefined}
            >
              Enregistrer comme nouveau deck
            </button>
          </div>
        )
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer ce deck ?"
        confirmLabel="Supprimer"
        danger
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      >
        Le deck « {loaded?.name} » sera effacé. Tes cartes restent dans ta collection.
      </ConfirmDialog>
    </div>
  );
}
