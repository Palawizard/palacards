import type { ReactNode } from "react";

/** Pages publiques : une colonne étroite, comme la page « Se connecter » de Wikipédia. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center px-5 py-10">
      <p className="mb-8 font-serif text-[2.1rem] leading-none tracking-[-0.01em]">
        Pala<span className="text-accent">Cards</span>
      </p>
      {children}
      <p className="mt-10 text-xs leading-relaxed text-faint">
        Chaque carte est un article de Wikipédia en français. Textes et images sous licence CC BY-SA, crédités sur
        chaque carte.
      </p>
    </main>
  );
}
