import type { NextConfig } from "next";

// Next ne lit que apps/web/.env : on charge aussi le .env racine du monorepo.
try {
  process.loadEnvFile("../../.env");
} catch {
  // pas de .env (build Docker) : l'API est sur la même origine
}

// Chemin public : vide en production (palacards.fr, à la racine), /palacards par défaut (dev, CI, E2E).
// Lu au build : le Dockerfile du front reçoit NEXT_PUBLIC_BASE_PATH et NEXT_PUBLIC_SITE_URL du compose.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/palacards";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `https://palacards.fr${basePath}`;

const nextConfig: NextConfig = {
  basePath,
  output: "standalone",
  // Build séparé pour les E2E (API de test sur un autre port), sans écraser .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@palacards/game", "@palacards/shared"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SITE_URL: siteUrl,
  },
};

export default nextConfig;
