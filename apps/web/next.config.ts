import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Servi sous www.palawi.fr/palacards/
  basePath: "/palacards",
  output: "standalone",
  transpilePackages: ["@palacards/game"],
};

export default nextConfig;
