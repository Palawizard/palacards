import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Aperçu des liens partagés (Discord, messageries, moteurs) : généré une fois au build.
export const alt = "PalaCards — WikiMasters, en mieux.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const icon = await readFile(join(process.cwd(), "src/app/icon.svg"), "base64");
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 72,
        padding: "0 96px",
        background: "radial-gradient(circle at 25% 20%, #1c2350 0%, #0c1027 70%)",
        color: "#f2f4fb",
        fontFamily: "sans-serif",
      }}
    >
      <img src={`data:image/svg+xml;base64,${icon}`} width={340} height={340} alt="" />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            width: "auto",
            alignSelf: "flex-start",
            transform: "rotate(-2deg)",
            background: "#1537a8",
            borderRadius: 24,
            padding: "10px 26px 6px",
            fontSize: 104,
            color: "#ffffff",
          }}
        >
          <span>PALA</span>
          <span style={{ color: "#ffd23f" }}>CARDS</span>
        </div>
        <div style={{ marginTop: 36, fontSize: 56 }}>WikiMasters, en mieux.</div>
        <div style={{ marginTop: 20, fontSize: 32, color: "#aeb5d6" }}>Chaque carte est un article de Wikipédia.</div>
      </div>
    </div>,
    size,
  );
}
