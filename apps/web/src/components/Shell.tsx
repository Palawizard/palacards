"use client";

import { Bell, Menu, Moon, Package, Search, Sun, X } from "lucide-react";
import { MotionConfig } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePackCountdown } from "@/lib/packs";
import { countdown, fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { NAV } from "@/lib/nav";
import { authClient } from "@/lib/auth-client";
import { setTheme, useTheme } from "@/lib/theme";

/** Logo : capitales condensées sur une pastille couverture, comme le titre d'un album. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/pulls"
      className={`inline-flex w-fit items-center rounded-lg bg-cover px-2 pb-[0.2rem] pt-[0.3rem] font-display text-[1.6rem] uppercase leading-none tracking-[0.01em] text-cover-ink ${className}`}
    >
      Pala<span className="text-accent">Cards</span>
    </Link>
  );
}

function Portal({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { me } = useMe();
  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-5">
      {NAV.map((group) => (
        <div key={group.title}>
          <h2 className="mb-1 px-2.5 font-display text-[0.9rem] uppercase tracking-[0.06em] text-cover-muted">
            {group.title}
          </h2>
          <ul className="flex flex-col">
            {group.items
              .filter((item) => !item.admin || me?.isAdmin)
              .map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                const badge = item.badge === "messages" ? (me?.unreadMessages ?? 0) : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 py-[0.45rem] pl-2.5 text-[0.93rem] font-medium transition-colors duration-150 ${
                        active
                          ? "-mr-4 rounded-l-[10px] bg-bg pr-6 text-text"
                          : "rounded-[10px] pr-2.5 text-cover-ink/80 hover:bg-white/10 hover:text-cover-ink"
                      }`}
                    >
                      <Icon
                        aria-hidden
                        className={`size-[1.05rem] ${active ? "text-highlight" : ""}`}
                        strokeWidth={2}
                      />
                      <span className="flex-1">{item.label}</span>
                      {badge > 0 && (
                        <span className="tnum rounded-full bg-accent px-1.5 text-[0.72rem] font-bold text-accent-ink">
                          {badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function PackStock() {
  const { me } = useMe();
  const { remaining, full } = usePackCountdown(me?.packs);
  if (!me) return <span className="h-8 w-24 animate-pulse rounded-xl bg-panel" aria-hidden />;
  return (
    <Link
      href="/pulls"
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm transition-colors duration-150 hover:bg-panel"
      title={full ? "Stock plein" : `Prochain paquet dans ${countdown(remaining)}`}
    >
      <Package aria-hidden className="size-4 text-muted" strokeWidth={1.75} />
      <span className="tnum font-semibold">
        {me.packs.available}
        <span className="text-faint">/{me.packs.max}</span>
      </span>
      {me.packs.bonus > 0 && <span className="tnum text-xs font-semibold text-highlight">+{me.packs.bonus}</span>}
      <span className="tnum hidden text-xs text-faint sm:inline">{full ? "plein" : countdown(remaining)}</span>
    </Link>
  );
}

function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="relative hidden w-full max-w-sm md:block"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/cards?q=${encodeURIComponent(q.trim())}` : "/cards");
      }}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
      />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Chercher un article…"
        aria-label="Chercher une carte"
        className="field h-9 min-h-0 rounded-full pl-8 text-sm"
      />
    </form>
  );
}

/** Bascule clair / sombre rapide ; le réglage « comme le système » est dans les paramètres. */
function ThemeToggle() {
  const pref = useTheme();
  const [systemDark, setSystemDark] = useState(true);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const dark = pref === "system" ? systemDark : pref === "dark";
  return (
    <button
      type="button"
      className="hidden size-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-panel hover:text-text sm:flex"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
      title={dark ? "Mode clair" : "Mode sombre"}
    >
      {dark ? (
        <Sun className="size-[1.1rem]" strokeWidth={1.75} />
      ) : (
        <Moon className="size-[1.1rem]" strokeWidth={1.75} />
      )}
    </button>
  );
}

function UserMenu() {
  const { me } = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (!me) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex size-9 items-center justify-center rounded-full border border-line-strong bg-panel-2 font-display text-base transition-colors duration-150 hover:border-faint"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Compte de ${me.displayName}`}
      >
        {me.avatar ?? me.displayName.slice(0, 1).toUpperCase()}
      </button>
      <div
        role="menu"
        data-open={open}
        inert={!open}
        className="absolute right-0 top-11 z-50 w-52 origin-top-right rounded-xl border border-line-strong bg-panel p-1 text-sm shadow-pop transition-[opacity,transform] duration-150 ease-[var(--ease-out)] data-[open=false]:pointer-events-none data-[open=false]:scale-95 data-[open=false]:opacity-0"
      >
        <p className="mb-1 border-b-2 border-dashed border-line px-2.5 pb-2 pt-1.5 font-semibold">{me.displayName}</p>
        <Link
          role="menuitem"
          href={`/u/${me.username}`}
          className="block rounded px-2.5 py-2 hover:bg-panel-2"
          onClick={() => setOpen(false)}
        >
          Mon profil
        </Link>
        <Link
          role="menuitem"
          href="/settings"
          className="block rounded px-2.5 py-2 hover:bg-panel-2"
          onClick={() => setOpen(false)}
        >
          Paramètres
        </Link>
        <button
          role="menuitem"
          type="button"
          className="block w-full rounded px-2.5 py-2 text-left text-danger hover:bg-panel-2"
          onClick={async () => {
            await authClient.signOut();
            router.replace("/login");
          }}
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Menu portail : colonne fixe sur grand écran, tiroir sur mobile. */}
      <aside className="cover-texture sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto bg-cover px-4 py-5 lg:flex">
        <Wordmark className="ml-0.5" />
        <Portal />
      </aside>

      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 lg:hidden ${drawer ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setDrawer(false)}
        aria-hidden
      />
      <aside
        aria-label="Menu"
        aria-hidden={!drawer}
        inert={!drawer}
        className={`cover-texture fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col gap-6 overflow-y-auto bg-cover px-4 py-5 transition-transform duration-300 ease-[var(--ease-drawer)] lg:hidden ${
          drawer ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <Wordmark className="ml-0.5" />
          <button
            type="button"
            className="btn btn-ghost btn-sm text-cover-ink hover:!bg-white/10"
            onClick={() => setDrawer(false)}
            aria-label="Fermer le menu"
          >
            <X className="size-5" />
          </button>
        </div>
        <Portal onNavigate={() => setDrawer(false)} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur-sm sm:gap-3 sm:px-5">
          <button
            type="button"
            className="btn btn-ghost btn-sm -ml-1 lg:hidden"
            onClick={() => setDrawer(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu className="size-5" />
          </button>
          {/* Sous 400 px (Android courant : 360 px), le logo texte ne tient pas avec les compteurs : il reste dans le tiroir. */}
          <Wordmark className="max-[399px]:hidden lg:hidden" />
          <SearchBox />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <PackStock />
            <Link
              href="/settings#wallet"
              className="tnum flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold transition-colors duration-150 hover:bg-panel"
              title={me ? `${fmt(me.wallet.balance)} PW dont ${fmt(me.wallet.locked)} bloqués` : undefined}
            >
              {me ? fmt(me.wallet.available) : "…"}
              <span className="text-xs font-normal text-faint">PW</span>
            </Link>
            <ThemeToggle />
            <Link
              href="/notifications"
              className="relative flex size-9 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-panel"
              aria-label={`Notifications${me?.unreadNotifications ? ` (${me.unreadNotifications} non lues)` : ""}`}
            >
              <Bell className="size-[1.15rem]" strokeWidth={1.75} />
              {!!me?.unreadNotifications && (
                <span className="tnum absolute right-0.5 top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[0.68rem] font-bold leading-4 text-accent-ink">
                  {me.unreadNotifications > 99 ? "99+" : me.unreadNotifications}
                </span>
              )}
            </Link>
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[76rem] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </main>
      </div>
    </div>
  );
}
