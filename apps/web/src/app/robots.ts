import type { MetadataRoute } from "next";
import { BASE_PATH, SITE_URL } from "@/lib/api";

// Servi à la racine de palacards.fr : l'API n'a rien à indexer, le sitemap liste les pages publiques.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: `${BASE_PATH}/api/` },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
