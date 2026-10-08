import type { NotificationDTO } from "@palacards/shared";
import { TITLE_BOARD_LABELS, titleDetail, type TitleBoard } from "@palacards/game";
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
    case "achievement_backfill": {
      const r = (p.reward ?? {}) as { pw?: unknown; packs?: unknown };
      const gain = [
        n(r.pw) ? `${fmt(n(r.pw))} PW` : "",
        n(r.packs) ? `${n(r.packs)} paquet${n(r.packs) > 1 ? "s" : ""}` : "",
      ]
        .filter(Boolean)
        .join(" et ");
      return {
        text: `Nouveaux succès à paliers : ${n(p.count)} déjà atteints, ${gain || "récompenses"} pour toi !`,
        href: "/achievements",
      };
    }
    case "title_won": {
      const board = s(p.board) as TitleBoard;
      const detail =
        board in TITLE_BOARD_LABELS ? ` (${titleDetail({ board, rank: n(p.rank), season: n(p.season) })})` : "";
      return { text: `Titre gagné : « ${s(p.name)} »${detail}. À afficher sur ton profil !`, href: "/profile" };
    }
    case "quest_completed": {
      const r = (p.reward ?? {}) as { pw?: unknown; xp?: unknown };
      return {
        text: `Quête ${p.period === "week" ? "de la semaine" : "du jour"} terminée : +${fmt(n(r.pw))} PW, +${fmt(n(r.xp))} XP.`,
        href: "/quests",
      };
    }
    case "pass_level":
      return { text: `Passe de saison : niveau ${n(p.level)} atteint !`, href: "/quests" };
    case "boss_killed": {
      const r = (p.reward ?? {}) as { pw?: unknown; packs?: unknown };
      return {
        text: p.late
          ? `Renfort payé : le boss du jour était déjà tombé, tu touches quand même +${fmt(n(r.pw))} PW et ${n(r.packs)} paquets.`
          : `${p.lastHit ? "Coup de grâce ! " : ""}Le boss du jour est tombé : +${fmt(n(r.pw))} PW et ${n(r.packs)} paquets.`,
        href: "/boss",
      };
    }
    case "boss_mvp": {
      const r = (p.reward ?? {}) as { packs?: unknown };
      const packs = n(r.packs);
      return {
        text: `Meilleur assaillant du boss d'hier (${fmt(n(p.damage))} dégâts) : ${packs} paquet${packs > 1 ? "s" : ""} bonus en plus.`,
        href: "/boss",
      };
    }
    case "boss_consolation":
      return { text: "Le boss d'hier a tenu bon. Lot de consolation : +30 PW.", href: "/boss" };
    case "gift": {
      const parts = [
        n(p.pw) ? `${fmt(n(p.pw))} PW` : "",
        n(p.packs) ? `${n(p.packs)} paquet${n(p.packs) > 1 ? "s" : ""} bonus` : "",
      ]
        .filter(Boolean)
        .join(" et ");
      return { text: `Cadeau pour tout le monde : ${parts} !${s(p.note) ? ` « ${s(p.note)} »` : ""}`, href: "/pulls" };
    }
    case "guild_objective": {
      const r = (p.reward ?? null) as { pw?: unknown; packs?: unknown; xp?: unknown } | null;
      if (!r) return { text: `Objectif de guilde atteint : un paquet bonus pour chacun !`, href: "/guild" };
      const packs = n(r.packs);
      return {
        text: `Objectif de guilde atteint : ${packs} paquet${packs > 1 ? "s" : ""} bonus, +${fmt(n(r.pw))} PW et +${fmt(n(r.xp))} XP pour toi !`,
        href: "/guild",
      };
    }
    case "suggestion_update": {
      const title = `« ${s(p.title)} »`;
      if (p.replied) return { text: `Palawi a répondu à ta suggestion ${title}.`, href: "/suggestions" };
      const text = (
        {
          accepted: `Ta suggestion ${title} est retenue !`,
          done: `Ta suggestion ${title} est en ligne. Merci !`,
          declined: `Ta suggestion ${title} n'est pas retenue pour l'instant.`,
          new: `Ta suggestion ${title} est de nouveau à l'étude.`,
        } as Record<string, string>
      )[s(p.status)];
      return { text: text ?? `Ta suggestion ${title} a été mise à jour.`, href: "/suggestions" };
    }
    default:
      return { text: "Nouvelle notification.", href: "/notifications" };
  }
}
