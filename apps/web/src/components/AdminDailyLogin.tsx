"use client";

import { DAILY_LOGIN_MAX_PW, dailyLoginSchedule, type DailyLoginRates } from "@palacards/game";
import type { AdminDailyLoginDTO } from "@palacards/shared";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt, relative } from "@/lib/format";

const NBSP = " ";
const FIELDS: { key: keyof DailyLoginRates; label: string }[] = [
  { key: "base", label: "Premier jour (PW)" },
  { key: "perStreakDay", label: "Par jour de série (PW)" },
  { key: "max", label: "Plafond (PW)" },
];

type Draft = Record<keyof DailyLoginRates, string>;
const toDraft = (r: DailyLoginRates): Draft => ({
  base: String(r.base),
  perStreakDay: String(r.perStreakDay),
  max: String(r.max),
});
const describe = (r: DailyLoginRates) =>
  `${fmt(r.base)}${NBSP}PW, +${fmt(r.perStreakDay)} par jour de série, max ${fmt(r.max)}${NBSP}PW`;

/** Montants du bonus de connexion quotidienne, appliqués à la prochaine connexion de chaque joueur. */
export function AdminDailyLogin() {
  const { data, error, mutate } = useSWR<AdminDailyLoginDTO>("/admin/daily-login");
  // null : champs non modifiés (on montre les montants en vigueur).
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const values = draft ?? (data ? toDraft(data.rates) : null);
  const rates: DailyLoginRates | null = values
    ? { base: Number(values.base), perStreakDay: Number(values.perStreakDay), max: Number(values.max) }
    : null;
  const invalid =
    !rates ||
    Object.values(values!).some((v) => v === "") ||
    Object.values(rates).some((n) => n > DAILY_LOGIN_MAX_PW) ||
    rates.base < 1 ||
    rates.max < rates.base;
  const unchanged =
    !!data && !!rates && (Object.keys(rates) as (keyof DailyLoginRates)[]).every((k) => rates[k] === data.rates[k]);
  const schedule = rates && !invalid ? dailyLoginSchedule(rates) : null;
  const capDay =
    rates && !invalid && rates.perStreakDay > 0 ? Math.ceil((rates.max - rates.base) / rates.perStreakDay) + 1 : 1;

  async function save(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy || !rates || invalid) return;
    setBusy(true);
    try {
      const res = await api<AdminDailyLoginDTO>("/admin/daily-login", { method: "PUT", body: rates });
      toast.success(`Bonus de connexion enregistré${NBSP}: appliqué dès la prochaine connexion.`);
      setDraft(null);
      void mutate(res, { revalidate: false });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="section-title mt-0">Bonus de connexion</h2>
      {error && <ErrorBox error={error} retry={() => mutate()} />}
      {!data && !error && <div className="h-32 animate-pulse rounded-xl bg-panel" />}
      {data && values && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Donné une fois par jour, et croissant avec la série de connexions. Un changement compte dès la prochaine
            connexion quotidienne, sans toucher aux PW déjà gagnés.
          </p>
          <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            {FIELDS.map((f) => (
              <label key={f.key}>
                <span className="label">{f.label}</span>
                <input
                  className="field tnum"
                  inputMode="numeric"
                  value={values[f.key]}
                  onChange={(e) => setDraft({ ...values, [f.key]: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                  required
                />
              </label>
            ))}
            <button type="submit" className="btn btn-primary" disabled={busy || invalid || unchanged}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
          </form>
          {rates && invalid && (
            <p className="text-xs text-danger">
              {rates.max < rates.base
                ? "Le plafond doit être au moins égal au bonus du premier jour."
                : `Entre 1 et ${fmt(DAILY_LOGIN_MAX_PW)}${NBSP}PW (0 possible pour la hausse par jour de série).`}
            </p>
          )}
          {schedule && (
            <table className="tnum w-full text-sm">
              <caption className="mb-1 text-left text-xs text-faint">
                Bonus selon la série
                {capDay > 1 ? ` · plafond atteint au jour ${capDay}` : ""}
              </caption>
              <thead>
                <tr className="text-left text-xs text-faint">
                  {schedule.map((_, i) => (
                    <th key={i} className="py-1.5 text-right font-semibold">
                      {i === schedule.length - 1 ? `Jour ${i + 1}+` : `Jour ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  {schedule.map((pw, i) => (
                    <td key={i} className="py-1.5 text-right font-semibold">
                      {fmt(pw)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
          <p className="text-xs text-faint">
            {data.updatedAt ? `Réglé ${relative(data.updatedAt)}` : "Valeurs par défaut en vigueur"}.{" "}
            {`Par défaut${NBSP}: ${describe(data.defaults)}. Au lancement${NBSP}: ${describe(data.launch)}.`}
          </p>
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDraft(toDraft(data.defaults))}
              disabled={busy}
            >
              Remettre les valeurs par défaut
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
