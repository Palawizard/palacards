import { ECONOMY, MAX_STORED_PACKS, PACK_REGEN_MS } from "@palacards/game";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Créer un compte" };

export default function Page() {
  return (
    <>
      <h1 className="page-title mb-2">Créer un compte</h1>
      <p className="mb-6 text-sm text-muted">
        Tu commences avec {MAX_STORED_PACKS} paquets et {ECONOMY.startingBalance} points wiki. Un nouveau paquet arrive
        toutes les {PACK_REGEN_MS / 60_000} minutes.
      </p>
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </>
  );
}
