import type { NextConfig } from "next";

// Next ne lit que apps/web/.env : on charge aussi le .env racine du monorepo.
try {
  process.loadEnvFile("../../.env");
} catch {
  // pas de .env (build Docker) : l'API est sur la même origine
}

const nextConfig: NextConfig = {
  // Servi sous www.palawi.fr/palacards/
  basePath: "/palacards",
  output: "standalone",
  transpilePackages: ["@palacards/game", "@palacards/shared"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
  },
};

export default nextConfig;
