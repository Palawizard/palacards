import type { NotificationDTO } from "@palacards/shared";
import { fmt } from "./format";

const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);

/** Texte et lien d'une notification (types émis par l'API). */
export function describe(notif: Pick<NotificationDTO, "type" | "payload">): { text: string; href: string } {
  const p = notif.payload;
  switch (notif.type) {
    case "outbid":
      return {
        text: p.bought
          ? "Une carte que tu visais a été achetée au prix immédiat."
          : `Ton enchère a été dépassée (${fmt(n(p.amount))} PW).`,
        href: "/market?scope=bidding",
      };
    case "auction_won":
      return { text: `Enchère gagnée : ${s(p.title)} pour ${fmt(n(p.price))} PW.`, href: `/card/${n(p.cardId)}` };
    case "auction_sold":
      return {
        text: `${s(p.title)} vendue ${fmt(n(p.price))} PW (tu reçois ${fmt(n(p.proceeds))} PW après la taxe).`,
        href: "/market?scope=mine",
      };
    case "auction_expired":
      return {
        text: "Ta vente s'est terminée sans offre : la carte est revenue dans ta collection.",
        href: "/market?scope=mine",
      };
    case "wishlist_listed":
      return { text: `${s(p.title)}, de ta wishlist, vient d'être mise en vente.`, href: "/market" };
    case "trade_received":
      return { text: "Tu as reçu une proposition d'échange.", href: "/trades" };
    case "trade_countered":
      return { text: "Tu as reçu une contre-offre.", href: "/trades" };
    case "trade_accepted":
      return { text: "Ton échange a été accepté.", href: "/trades?box=history" };
    case "trade_declined":
      return { text: "Ton échange a été refusé.", href: "/trades?box=history" };
    case "trade_expired":
      return { text: "Un échange a expiré sans réponse.", href: "/trades?box=history" };
    case "friend_request":
      return { text: `${s(p.from)} veut t'ajouter en ami.`, href: "/friends" };
    case "friend_accepted":
      return { text: `${s(p.from)} a accepté ta demande d'ami.`, href: "/friends" };
    case "battle_challenge":
      return { text: `${s(p.from)} te défie en duel.`, href: "/battle" };
    case "battle_result":
      return {
        text: p.won ? `Victoire contre ${s(p.opponent)} !` : `Défaite contre ${s(p.opponent)}.`,
        href: `/battle/${n(p.battleId)}`,
      };
    case "packs_full":
      return { text: "Ton stock de paquets est plein : ouvre-les pour relancer le minuteur.", href: "/pulls" };
    case "achievement":
      return { text: `Succès débloqué : ${s(p.name)}.`, href: "/achievements" };
    case "guild_objective":
      return { text: `Objectif de guilde atteint : un paquet bonus pour chacun !`, href: "/guild" };
    default:
      return { text: "Nouvelle notification.", href: "/notifications" };
  }
}
