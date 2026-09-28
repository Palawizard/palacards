const nf = new Intl.NumberFormat("fr-FR");

/** 12345 → « 12 345 ». */
export const fmt = (n: number) => nf.format(n);

/** Compte à rebours mm:ss (ou h:mm:ss). */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Durée restante lisible : « 2 j 4 h », « 5 h 12 min », « 8 min ». */
export function timeLeft(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d > 0) return h ? `${d} j ${h} h` : `${d} j`;
  if (h > 0) return `${h} h ${String(min % 60).padStart(2, "0")} min`;
  return `${Math.max(1, min)} min`;
}

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
/** « il y a 5 min », « dans 2 h ». */
export function relative(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

/** Vues compactes : 1,2 M. */
export const compact = (n: number) =>
  new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const REASONS: Record<string, string> = {
  signup: "Inscription",
  pack_open: "Ouverture de paquet",
  recycle: "Recyclage",
  fusion: "Fusion",
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
  upgrade: "Upgrader",
  wheel: "Roue du jour",
  promo_code: "Code promo",
  theme_pack: "Booster à thème",
  test: "Test",
};
/** Motif d'une ligne du ledger, en français (code brut si inconnu). */
export const reasonLabel = (reason: string) => REASONS[reason] ?? reason;
