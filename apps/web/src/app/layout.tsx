import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";
import { Toaster } from "@/components/Toaster";
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
    // Le script de thème pose data-theme avant l'hydratation : React ne doit pas s'en plaindre.
    <html lang="fr" className={archivo.variable} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
