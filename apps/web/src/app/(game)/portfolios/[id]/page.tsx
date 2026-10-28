"use client";

import type { PortfolioDTO } from "@palacards/shared";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import useSWR from "swr";
import { PortfolioActions, PortfolioView } from "@/components/Portfolio";
import { ErrorBox } from "@/components/ui";

/** Page publique d'un portfolio (lien partageable). */
export default function PortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: p, error, mutate } = useSWR<PortfolioDTO>(`/portfolios/${encodeURIComponent(id)}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/portfolios" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ChevronLeft aria-hidden className="size-4" /> Portfolios
        </Link>
        {p && <PortfolioActions p={p} />}
      </div>
      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !p ? (
        <div className="h-[32rem] animate-pulse rounded-[18px] bg-panel" aria-busy />
      ) : (
        <PortfolioView p={p} />
      )}
    </div>
  );
}
