"use client";

import { ECONOMY } from "@palacards/game";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { ConfirmDialog, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt, relative } from "@/lib/format";
import { useNow } from "@/lib/use-now";

interface AdminTheme {
  id: number;
  name: string;
  categories: string[];
  price: number;
  startsAt: string;
  endsAt: string;
  cardCount: number;
  sold: number;
  onSale: boolean;
}

interface AdminCode {
  code: string;
  pw: number;
  packs: number;
  themeId: number | null;
  themeName: string | null;
  themePacks: number;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  disabled: boolean;
  createdAt: string;
}

/** Valeur d'un <input type="datetime-local"> (heure locale du navigateur). */
function localInput(d: Date): string {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

const digits = (v: string) => v.replace(/[^\d]/g, "");
const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const short = (iso: string) => dateFmt.format(new Date(iso));

function themeState(t: AdminTheme, now: number) {
  if (t.onSale) return { label: "En vente", className: "bg-good/15 text-good" };
  if (new Date(t.startsAt).getTime() > now) return { label: "À venir", className: "bg-warn/15 text-warn" };
  return { label: "Terminé", className: "bg-panel-2 text-faint" };
}

/** Boosters à thème : création (catégories Wikipédia et/ou titres) et liste. */
export function AdminThemes() {
  const list = useSWR<AdminTheme[]>("/admin/themes");
  const [name, setName] = useState("");
  const [categories, setCategories] = useState("");
  const [depth, setDepth] = useState("1");
  const [titles, setTitles] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState(String(ECONOMY.themePackPrice));
  const [startsAt, setStartsAt] = useState(() => localInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => localInput(new Date(Date.now() + 7 * 86_400_000)));
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState<AdminTheme | null>(null);
  const now = useNow(30_000);

  const lines = (v: string) =>
    v
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
  const titleList = lines(titles);
  const categoryList = lines(categories);

  async function create(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ cardCount: number; name: string }>("/admin/themes", {
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          categories: categoryList,
          depth: Number(depth),
          titles: titleList,
          price: Number(price) || ECONOMY.themePackPrice,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        },
      });
      toast.success(`Booster « ${res.name} » créé : ${fmt(res.cardCount)} articles.`);
      setName("");
      setCategories("");
      setTitles("");
      setDescription("");
      void list.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function end(t: AdminTheme) {
    try {
      await api(`/admin/themes/${t.id}/end`, { method: "POST" });
      toast.success(`Vente de « ${t.name} » terminée.`);
      void list.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de terminer ce thème.");
    }
  }

  return (
    <section>
      <h2 className="section-title mt-0">Boosters à thème</h2>
      <form onSubmit={create} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <label className="sm:col-span-2">
          <span className="label">Nom du booster</span>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Jeux vidéo"
            required
          />
        </label>
        <label className="sm:col-span-3">
          <span className="label">Catégories Wikipédia (une par ligne)</span>
          <textarea
            className="field min-h-20 py-2"
            value={categories}
            onChange={(e) => setCategories(e.target.value)}
            placeholder={"Chanteur français\nChanteuse française, ou l’URL de la catégorie"}
          />
        </label>
        <label>
          <span className="label">Sous-catégories</span>
          <select className="field" value={depth} onChange={(e) => setDepth(e.target.value)}>
            <option value="0">Aucune</option>
            <option value="1">1 niveau</option>
            <option value="2">2 niveaux</option>
          </select>
        </label>
        <label className="sm:col-span-3">
          <span className="label">Titres en plus (un par ligne, facultatif)</span>
          <textarea
            className="field min-h-20 py-2"
            value={titles}
            onChange={(e) => setTitles(e.target.value)}
            placeholder={"Super Mario Bros.\nThe Legend of Zelda"}
          />
        </label>
        <label className="sm:col-span-3">
          <span className="label">Description (facultatif)</span>
          <textarea
            className="field min-h-20 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
          />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Début</span>
          <input
            type="datetime-local"
            className="field"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Fin</span>
          <input
            type="datetime-local"
            className="field"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          />
        </label>
        <label>
          <span className="label">Prix (PW)</span>
          <input
            className="field tnum"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(digits(e.target.value))}
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={busy || name.trim().length < 2 || (!categoryList.length && !titleList.length)}
          >
            {busy ? "Lecture de Wikipédia…" : "Créer"}
          </button>
        </div>
      </form>

      {list.error && <ErrorBox error={list.error} retry={() => list.mutate()} />}
      {list.data && list.data.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="tnum w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="py-1.5 font-semibold">Booster</th>
                <th className="py-1.5 font-semibold">Période</th>
                <th className="py-1.5 text-right font-semibold">Articles</th>
                <th className="py-1.5 text-right font-semibold">Prix</th>
                <th className="py-1.5 text-right font-semibold">Vendus</th>
                <th className="py-1.5 pl-3 font-semibold">État</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((t) => {
                const state = themeState(t, now);
                return (
                  <tr key={t.id} className="border-t border-line">
                    <td className="py-1.5 pr-3">
                      <span className="font-semibold">{t.name}</span>
                      {t.categories.length > 0 && (
                        <span className="block text-xs text-faint">{t.categories.join(" · ")}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-muted">
                      {short(t.startsAt)} → {short(t.endsAt)}
                    </td>
                    <td className="py-1.5 text-right">{fmt(t.cardCount)}</td>
                    <td className="py-1.5 text-right">{fmt(t.price)}</td>
                    <td className="py-1.5 text-right">{fmt(t.sold)}</td>
                    <td className="py-1.5 pl-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${state.className}`}>
                        {state.label}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      {new Date(t.endsAt).getTime() > now && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEnding(t)}>
                          Terminer
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!ending}
        danger
        title="Terminer la vente ?"
        confirmLabel="Terminer maintenant"
        onConfirm={() => ending && end(ending)}
        onClose={() => setEnding(null)}
      >
        Le booster « {ending?.name} » ne sera plus en vente. Les boosters déjà achetés ou reçus par code restent
        ouvrables.
      </ConfirmDialog>
    </section>
  );
}

/** Codes promo : création et liste (activer / désactiver). */
export function AdminCodes() {
  const list = useSWR<AdminCode[]>("/admin/codes");
  const themes = useSWR<AdminTheme[]>("/admin/themes");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [packs, setPacks] = useState("");
  const [themeId, setThemeId] = useState("");
  const [themePacks, setThemePacks] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const now = useNow(30_000);

  const empty = !Number(pw) && !Number(packs) && !(Number(themePacks) && themeId);

  async function create(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ code: string }>("/admin/codes", {
        body: {
          code: code.trim(),
          pw: Number(pw) || 0,
          packs: Number(packs) || 0,
          themeId: themeId ? Number(themeId) : null,
          themePacks: themeId ? Number(themePacks) || 0 : 0,
          maxUses: Number(maxUses) || null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
      });
      toast.success(`Code ${res.code} créé.`);
      setCode("");
      void list.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function setDisabled(c: AdminCode, disabled: boolean) {
    try {
      await api(`/admin/codes/${encodeURIComponent(c.code)}/disabled`, { body: { disabled } });
      void list.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Modification impossible.");
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${value} copié.`);
    } catch {
      toast.error("Copie impossible.");
    }
  }

  const gains = (c: AdminCode) =>
    [
      c.pw ? `${fmt(c.pw)} PW` : "",
      c.packs ? `${c.packs} paquet${c.packs > 1 ? "s" : ""}` : "",
      c.themePacks ? `${c.themePacks} × ${c.themeName ?? "booster supprimé"}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <section>
      <h2 className="section-title mt-0">Codes promo</h2>
      <form onSubmit={create} className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <label className="col-span-2">
          <span className="label">Code</span>
          <input
            className="field font-semibold uppercase tracking-[0.08em]"
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9_-]/g, "")
                  .slice(0, 32),
              )
            }
            placeholder="NOEL2026"
            required
          />
        </label>
        <label>
          <span className="label">PW</span>
          <input
            className="field tnum"
            inputMode="numeric"
            value={pw}
            onChange={(e) => setPw(digits(e.target.value))}
          />
        </label>
        <label>
          <span className="label">Paquets bonus</span>
          <input
            className="field tnum"
            inputMode="numeric"
            value={packs}
            onChange={(e) => setPacks(digits(e.target.value))}
          />
        </label>
        <label>
          <span className="label">Booster à thème</span>
          <select className="field" value={themeId} onChange={(e) => setThemeId(e.target.value)}>
            <option value="">Aucun</option>
            {(themes.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Boosters</span>
          <input
            className="field tnum"
            inputMode="numeric"
            value={themePacks}
            disabled={!themeId}
            onChange={(e) => setThemePacks(digits(e.target.value))}
          />
        </label>
        <label className="col-span-1 sm:col-span-2">
          <span className="label">Utilisations max (vide : illimité)</span>
          <input
            className="field tnum"
            inputMode="numeric"
            value={maxUses}
            onChange={(e) => setMaxUses(digits(e.target.value))}
          />
        </label>
        <label className="col-span-1 sm:col-span-2">
          <span className="label">Expire le (facultatif)</span>
          <input
            type="datetime-local"
            className="field"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
        <div className="col-span-2 flex items-end">
          <button type="submit" className="btn btn-primary w-full" disabled={busy || code.length < 3 || empty}>
            {busy ? "Création…" : "Créer le code"}
          </button>
        </div>
      </form>
      <p className="mt-2 text-xs text-faint">Chaque joueur ne peut utiliser un code qu’une seule fois.</p>

      {list.error && <ErrorBox error={list.error} retry={() => list.mutate()} />}
      {list.data && list.data.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="tnum w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="py-1.5 font-semibold">Code</th>
                <th className="py-1.5 font-semibold">Gains</th>
                <th className="py-1.5 text-right font-semibold">Utilisé</th>
                <th className="py-1.5 pl-3 font-semibold">Expiration</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => {
                const expired = !!c.expiresAt && new Date(c.expiresAt).getTime() <= now;
                const exhausted = c.maxUses !== null && c.uses >= c.maxUses;
                return (
                  <tr key={c.code} className={`border-t border-line ${c.disabled || expired ? "text-faint" : ""}`}>
                    <td className="py-1.5 pr-3">
                      <button
                        type="button"
                        onClick={() => copy(c.code)}
                        className="inline-flex items-center gap-1.5 font-semibold tracking-[0.06em] hover:text-highlight"
                        title="Copier le code"
                      >
                        {c.code}
                        <Copy aria-hidden className="size-3.5 opacity-60" />
                      </button>
                    </td>
                    <td className="py-1.5 pr-3 text-muted">{gains(c)}</td>
                    <td className="py-1.5 text-right">
                      {fmt(c.uses)}
                      <span className="text-faint">{c.maxUses !== null ? ` / ${fmt(c.maxUses)}` : ""}</span>
                    </td>
                    <td className="py-1.5 pl-3 text-muted">
                      {c.disabled
                        ? "Désactivé"
                        : exhausted
                          ? "Épuisé"
                          : c.expiresAt
                            ? expired
                              ? "Expiré"
                              : relative(c.expiresAt)
                            : "Jamais"}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setDisabled(c, !c.disabled)}
                      >
                        {c.disabled ? "Réactiver" : "Désactiver"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
