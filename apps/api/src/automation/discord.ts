/**
 * Message Discord (webhook d'un salon privé de l'admin). Sans webhook configuré, ne fait rien.
 * Jamais de mention (@everyone, rôles, joueurs) : le texte peut reprendre une suggestion de joueur.
 */
export async function postDiscord(webhookUrl: string | undefined, content: string): Promise<void> {
  if (!webhookUrl) return;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: truncate(content, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord : HTTP ${res.status}`);
}

/** Coupe un texte trop long pour un message Discord (2 000 caractères au plus). */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Citation Discord sur plusieurs lignes, sans liens cliquables ni mise en forme venant du joueur. */
export function quote(text: string, max = 300): string {
  const clean = truncate(text.replace(/[`*_~|>]/g, "").replace(/https?:\/\//g, ""), max);
  return clean
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}
