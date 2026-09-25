import type { ReactNode } from "react";

/** Pages publiques : une colonne étroite, comme la page « Se connecter » de Wikipédia. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center px-5 py-10">
      <p className="mb-8 w-fit rotate-[-2deg] rounded-xl bg-cover px-3 pb-1 pt-1.5 font-display text-[2.6rem] uppercase leading-none text-cover-ink shadow-lift">
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
