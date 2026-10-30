"use client";

import type { PortfolioDTO } from "@palacards/shared";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use } from "react";
import useSWR from "swr";
import { InvitationAnswer, PortfolioActions, PortfolioView } from "@/components/Portfolio";
import { ErrorBox } from "@/components/ui";
import { useMe } from "@/lib/game";

/** Page publique d'un portfolio (lien partageable). */
export default function PortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const router = useRouter();
  const { data: p, error, mutate } = useSWR<PortfolioDTO>(`/portfolios/${encodeURIComponent(id)}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/portfolios" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ChevronLeft aria-hidden className="size-4" /> Portfolios
        </Link>
        {p && <PortfolioActions p={p} />}
      </div>
      {p?.role === "invited" && me && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-panel px-4 py-3">
          <p className="min-w-0 flex-1 basis-64 text-sm [text-wrap:pretty]">
            <strong>{p.owner.displayName}</strong> t’invite à composer ce portfolio : tu pourras y ajouter tes propres
            cartes, qui resteront dans ta collection.
          </p>
          <InvitationAnswer
            p={p}
            me={me.username}
            onDone={(joined) => (joined ? void mutate() : router.push("/portfolios"))}
          />
        </div>
      )}
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
