"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-1 border-r border-line bg-panel p-4">
      <Link href="/pulls" className="mb-6 px-3 text-2xl font-bold">
        <span className="text-accent">Pala</span>Cards
      </Link>
      {NAV.map((item) => {
        const active = pathname === `/${item.slug}`;
        return (
          <Link
            key={item.slug}
            href={`/${item.slug}`}
            className={`rounded-lg px-3 py-2 text-sm transition ${
              active ? "bg-accent/15 text-accent" : "text-muted hover:bg-white/5 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
