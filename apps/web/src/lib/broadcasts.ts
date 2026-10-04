import type { BroadcastDTO } from "@palacards/shared";
import { Megaphone, Rocket, Siren, Sparkles, type LucideIcon } from "lucide-react";

/** Ton d'un message serveur : libellé et icône, partagés par l'affiche et la page « Mises à jour ». */
export const BROADCAST_TONE: Record<BroadcastDTO["tone"], { label: string; icon: LucideIcon }> = {
  info: { label: "Message de l'équipe", icon: Megaphone },
  update: { label: "Mise à jour", icon: Rocket },
  event: { label: "Événement", icon: Sparkles },
  warning: { label: "Important", icon: Siren },
};

export type BodyBlock = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

const BULLET = /^\s*[•\-–]\s+/;

/** Typographie française : espace fine insécable avant « : ; ! ? » et à l'intérieur des guillemets. */
const nbsp = (text: string) => text.replace(/ ([:;!?»])/g, "\u202f$1").replace(/« /g, "«\u202f");

/**
 * Découpe le texte brut d'un message en blocs lisibles : une ligne vide sépare les paragraphes, une suite de
 * lignes qui commencent par « • » ou « - » devient une liste. Le texte reste du texte (aucun HTML interprété).
 */
export function bodyBlocks(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: nbsp(para.join("\n")) });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "ul", items: list });
    list = [];
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (BULLET.test(line)) {
      flushPara();
      list.push(nbsp(line.replace(BULLET, "")));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
