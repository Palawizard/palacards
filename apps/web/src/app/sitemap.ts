import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/api";

// Seules les pages publiques : le reste demande une session (voir proxy.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/login", "/register", "/confidentialite"].map((path) => ({ url: `${SITE_URL}${path}` }));
}
