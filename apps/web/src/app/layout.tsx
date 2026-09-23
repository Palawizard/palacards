import type { Metadata, Viewport } from "next";
import { Libertinus_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "./globals.css";

const libertinus = Libertinus_Serif({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-libertinus",
  display: "swap",
  fallback: ["Georgia", "serif"],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: "PalaCards", template: "%s · PalaCards" },
  description: "Le jeu de cartes à collectionner du Wikipédia FR, entre potes.",
};

export const viewport: Viewport = {
  themeColor: "#0f1115",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={libertinus.variable}>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster
          theme="dark"
          position="bottom-center"
          toastOptions={{
            style: {
              background: "var(--color-panel-2)",
              border: "1px solid var(--color-line-strong)",
              color: "var(--color-text)",
              fontFamily: "var(--font-sans)",
            },
          }}
        />
      </body>
    </html>
  );
}
