import type { MetadataRoute } from "next";
import { BASE_PATH } from "@/lib/api";

// Les URL du manifeste ne reçoivent pas le basePath automatiquement.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PalaCards",
    short_name: "PalaCards",
    description: "WikiMasters, en mieux.",
    lang: "fr",
    start_url: `${BASE_PATH}/pulls`,
    scope: `${BASE_PATH}/`,
    display: "standalone",
    background_color: "#0c1027",
    theme_color: "#0c1027",
    icons: [
      { src: `${BASE_PATH}/icon.svg`, sizes: "any", type: "image/svg+xml" },
      { src: `${BASE_PATH}/apple-icon.png`, sizes: "180x180", type: "image/png" },
    ],
  };
}
