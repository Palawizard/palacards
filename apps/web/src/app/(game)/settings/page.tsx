"use client";

import type { MeDTO } from "@palacards/shared";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Avatar } from "@/components/Avatar";
import { api, ApiError } from "@/lib/api";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { fmt, relative } from "@/lib/format";
import { useMe } from "@/lib/game";

const AVATARS = ["🦉", "🐉", "🦊", "🐺", "🦁", "🐙", "🦄", "🐢", "🦋", "🌋", "🗿", "🎭", "🧭", "📜", "🪐", "⚓"];
const GROUPS: Record<string, string> = {
  market: "Marché (enchères, ventes, wishlist)",
  trades: "Échanges",
  social: "Amis et guilde",
  battles: "Duels",
  packs: "Stock de paquets plein",
  achievements: "Succès",
};
const SPEEDS = [
  { value: "normal", label: "Animée" },
  { value: "fast", label: "Rapide" },
  { value: "instant", label: "Instantanée" },
] as const;
const REASONS: Record<string, string> = {
  signup: "Inscription",
  recycle: "Recyclage",
  daily_login: "Bonus du jour",
  battle: "Duel",
  achievement: "Succès",
  bonus_pack: "Paquet bonus",
  market_fee: "Frais d’annonce",
  market_purchase: "Achat au marché",
  market_sale: "Vente au marché",
  market_tax: "Taxe de vente",
  trade: "Échange",
  admin: "Admin",
  guild_objective: "Objectif de guilde",
};

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="section-title mt-0">{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { me, mutateMe } = useMe();
  const [username, setUsername] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const prefs = useSWR<{ group: string; enabled: boolean }[]>("/settings/notifications");
  const history = useSWR<{ id: number; delta: number; balanceAfter: number; reason: string; createdAt: string }[]>("/wallet/history");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : "Réglage non enregistré.");
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <div className="h-96 animate-pulse rounded-md bg-panel" aria-busy />;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="page-title">Paramètres</h1>

      <Section title="Profil">
        <div className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await mutateMe(api<MeDTO>("/settings/username", { body: { username } }), { revalidate: false });
                setUsername("");
              }, "Pseudo modifié.");
            }}
          >
            <label className="min-w-56 flex-1">
              <span className="label">Pseudo (actuel : {me.displayName})</span>
              <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nouveau pseudo" maxLength={20} autoCapitalize="none" />
            </label>
            <button type="submit" className="btn" disabled={busy || username.trim().length < 3}>
              Changer de pseudo
            </button>
          </form>
          <fieldset>
            <legend className="label">Avatar</legend>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-pressed={!me.avatar}
                className="rounded-full p-0.5 aria-pressed:ring-2 aria-pressed:ring-accent"
                onClick={() => run(() => mutateMe(api<MeDTO>("/me/settings", { method: "PATCH", body: { avatar: null } }), { revalidate: false }), "Avatar mis à jour.")}
                aria-label="Initiale du pseudo"
              >
                <Avatar name={me.displayName} avatar={null} size="sm" />
              </button>
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={me.avatar === a}
                  className="grid size-9 place-items-center rounded-full border border-line-strong text-lg aria-pressed:border-accent aria-pressed:bg-accent/15"
                  onClick={() => run(() => mutateMe(api<MeDTO>("/me/settings", { method: "PATCH", body: { avatar: a } }), { revalidate: false }), "Avatar mis à jour.")}
                >
                  {a}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </Section>

      <Section title="Mot de passe">
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const res = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
              if (res.error) throw new Error(authErrorMessage(res.error.code, "Mot de passe actuel incorrect."));
              setCurrent("");
              setNext("");
            }, "Mot de passe modifié. Tes autres sessions sont déconnectées.");
          }}
        >
          <label>
            <span className="label">Mot de passe actuel</span>
            <input type="password" className="field" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label>
            <span className="label">Nouveau (8 caractères min.)</span>
            <input type="password" className="field" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} />
          </label>
          <button type="submit" className="btn" disabled={busy || !current || next.length < 8}>
            Modifier
          </button>
        </form>
      </Section>

      <Section title="Ouverture des paquets">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Vitesse d'ouverture">
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={me.animationSpeed === s.value}
              className="chip h-9 px-4 aria-checked:border-accent aria-checked:bg-accent/15 aria-checked:text-accent-strong"
              onClick={() => run(() => mutateMe(api<MeDTO>("/me/settings", { method: "PATCH", body: { animationSpeed: s.value } }), { revalidate: false }), "Réglage enregistré.")}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Notifications">
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-panel">
          {(prefs.data ?? []).map((p) => (
            <li key={p.group}>
              <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
                <span>{GROUPS[p.group] ?? p.group}</span>
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={p.enabled}
                  onChange={(e) => {
                    const body = Object.fromEntries((prefs.data ?? []).map((x) => [x.group, x.group === p.group ? e.target.checked : x.enabled]));
                    void run(async () => {
                      await api("/settings/notifications", { method: "PUT", body });
                      await prefs.mutate();
                    }, "Préférences enregistrées.");
                  }}
                />
              </label>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Portefeuille" id="wallet">
        <p className="tnum mb-3 text-sm text-muted">
          Solde : <strong className="text-text">{fmt(me.wallet.balance)} PW</strong>, dont {fmt(me.wallet.locked)} bloqués dans des enchères ou des échanges.
        </p>
        {history.data?.length ? (
          <table className="tnum w-full text-sm">
            <tbody>
              {history.data.map((l) => (
                <tr key={l.id} className="border-b border-line">
                  <td className="py-1.5 pr-3 text-faint">{relative(l.createdAt)}</td>
                  <td className="py-1.5 pr-3">{REASONS[l.reason] ?? l.reason}</td>
                  <td className={`py-1.5 pr-3 text-right font-semibold ${l.delta > 0 ? "text-accent" : "text-danger"}`}>
                    {l.delta > 0 ? "+" : ""}
                    {fmt(l.delta)}
                  </td>
                  <td className="py-1.5 text-right text-faint">{fmt(l.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-faint">Aucun mouvement.</p>
        )}
      </Section>
    </div>
  );
}
