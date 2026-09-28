import { ECONOMY, MAX_STORED_PACKS, PACK_REGEN_MS } from "@palacards/game";
import type { Metadata } from "next";
import Link from "next/link";
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
      <p className="-mt-3 mb-6 text-xs text-faint">
        Le jeu garde ton pseudo, ta partie et tes messages tant que ton compte existe ; tu peux tout télécharger ou tout
        supprimer depuis les Paramètres.{" "}
        <Link href="/confidentialite" className="underline underline-offset-2 hover:text-muted">
          Politique de confidentialité
        </Link>
      </p>
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </>
  );
}
