"use client";

import { Bell, Menu, Package, Search, X } from "lucide-react";
import { MotionConfig } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePackCountdown } from "@/lib/packs";
import { countdown, fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { NAV } from "@/lib/nav";
import { authClient } from "@/lib/auth-client";

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/pulls" className={`font-serif text-[1.45rem] leading-none tracking-[-0.01em] ${className}`}>
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
          <h2 className="mb-1.5 border-b border-line px-2 pb-1 text-[0.78rem] font-semibold text-faint">
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
                      className={`flex items-center gap-2.5 rounded-md px-2 py-[0.42rem] text-[0.93rem] transition-colors duration-150 ${
                        active ? "bg-panel-2 text-text" : "text-muted hover:bg-panel hover:text-text"
                      }`}
                    >
                      <Icon
                        aria-hidden
                        className={`size-[1.05rem] ${active ? "text-accent" : ""}`}
                        strokeWidth={1.75}
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
  if (!me) return <span className="h-8 w-24 animate-pulse rounded-md bg-panel" aria-hidden />;
  return (
    <Link
      href="/pulls"
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-panel"
      title={full ? "Stock plein" : `Prochain paquet dans ${countdown(remaining)}`}
    >
      <Package aria-hidden className="size-4 text-muted" strokeWidth={1.75} />
      <span className="tnum font-semibold">
        {me.packs.available}
        <span className="text-faint">/{me.packs.max}</span>
      </span>
      {me.packs.bonus > 0 && <span className="tnum text-xs text-accent">+{me.packs.bonus}</span>}
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
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!me) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex size-9 items-center justify-center rounded-full border border-line-strong bg-panel-2 font-serif text-base"
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
        className="absolute right-0 top-11 z-50 w-52 origin-top-right rounded-md border border-line-strong bg-panel p-1 text-sm shadow-[0_12px_30px_-10px_rgb(0_0_0/0.8)] transition-[opacity,transform] duration-150 ease-[var(--ease-out)] data-[open=false]:pointer-events-none data-[open=false]:scale-95 data-[open=false]:opacity-0"
      >
        <p className="border-b border-line px-2.5 py-2 font-semibold">{me.displayName}</p>
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
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-line px-4 py-5 lg:flex">
        <Wordmark className="px-2" />
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
        className={`fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col gap-6 overflow-y-auto border-r border-line bg-bg px-4 py-5 transition-transform duration-300 ease-[var(--ease-drawer)] lg:hidden ${
          drawer ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <Wordmark className="px-2" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
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
          <Wordmark className="lg:hidden" />
          <SearchBox />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <PackStock />
            <Link
              href="/settings#wallet"
              className="tnum flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold hover:bg-panel"
              title={me ? `${fmt(me.wallet.balance)} PW dont ${fmt(me.wallet.locked)} bloqués` : undefined}
            >
              {me ? fmt(me.wallet.available) : "…"}
              <span className="text-xs font-normal text-faint">PW</span>
            </Link>
            <Link
              href="/notifications"
              className="relative flex size-9 items-center justify-center rounded-md hover:bg-panel"
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
