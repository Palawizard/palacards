import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";

// Une seule famille variable : largeur normale pour le texte, extra-condensée pour les titres.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "PalaCards", template: "%s · PalaCards" },
  description: "Le jeu de cartes à collectionner du Wikipédia FR, entre potes.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef0f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1027" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Le script du <head> pose data-theme avant l'hydratation : React ne doit pas s'en plaindre.
    <html lang="fr" className={archivo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster
          theme="system"
          position="bottom-center"
          toastOptions={{
            style: {
              background: "var(--color-panel-2)",
              border: "1px solid var(--color-line-strong)",
              borderRadius: "12px",
              color: "var(--color-text)",
              fontFamily: "var(--font-sans)",
            },
          }}
        />
      </body>
    </html>
  );
}
