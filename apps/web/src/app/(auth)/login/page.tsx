import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Connexion" };

export default function Page() {
  return (
    <>
      <h1 className="page-title mb-2">Connexion</h1>
      <p className="mb-6 text-sm text-muted">Content de te revoir. Tes paquets se sont remplis pendant ton absence.</p>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </>
  );
}
