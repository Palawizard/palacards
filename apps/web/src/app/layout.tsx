import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";
import { Toaster } from "@/components/Toaster";
import { SITE_URL } from "@/lib/api";
import { THEME_SCRIPT } from "@/lib/theme";

// Une seule famille variable : largeur normale pour le texte, extra-condensée pour les titres.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const DESCRIPTION = "WikiMasters, en mieux.";

export const metadata: Metadata = {
  // Base des URL absolues (canonical, Open Graph) : Next y joint les chemins relatifs, basePath compris.
  metadataBase: new URL(SITE_URL),
  title: { default: "PalaCards", template: "%s · PalaCards" },
  description: DESCRIPTION,
  applicationName: "PalaCards",
  openGraph: {
    type: "website",
    siteName: "PalaCards",
    locale: "fr_FR",
    title: "PalaCards",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
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
