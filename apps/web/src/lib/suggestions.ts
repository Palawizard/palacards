import type { SuggestionKind, SuggestionStatus } from "@palacards/shared";
import { Bug, Lightbulb, MessageCircleMore, Scale, Sparkles, type LucideIcon } from "lucide-react";

/** Types de suggestion : libellé, aide et exemples de saisie (page Suggestions et admin). */
export const KINDS: Record<
  SuggestionKind,
  { label: string; hint: string; icon: LucideIcon; title: string; body: string }
> = {
  bug: {
    label: "Un bug",
    hint: "Quelque chose ne marche pas",
    icon: Bug,
    title: "Le bouton « Vendre » ne répond plus",
    body: "Ce que tu faisais, ce qui s'est passé, ce que tu attendais. Sur téléphone ou ordinateur ?",
  },
  feature: {
    label: "Une fonctionnalité",
    hint: "Une nouvelle façon de jouer",
    icon: Lightbulb,
    title: "Pouvoir offrir une carte à un ami",
    body: "Ce que tu aimerais pouvoir faire, et pourquoi ça rendrait le jeu meilleur.",
  },
  content: {
    label: "Du contenu",
    hint: "Booster, quête, succès…",
    icon: Sparkles,
    title: "Un booster « Jeux vidéo »",
    body: "Le thème, quelques articles qui devraient y être, l'ambiance que tu imagines.",
  },
  balance: {
    label: "L'équilibrage",
    hint: "Prix, taux, récompenses",
    icon: Scale,
    title: "Les boosters à thème sont trop chers",
    body: "Ce qui te semble déséquilibré, et ce que tu proposerais à la place.",
  },
  other: {
    label: "Autre chose",
    hint: "Tout le reste",
    icon: MessageCircleMore,
    title: "Un petit mot pour Palawi",
    body: "Ce que tu veux lui dire.",
  },
};

/** Statuts : libellé côté joueur et côté admin (« Envoyée » pour l'un, « Nouvelle » pour l'autre). */
export const STATUSES: Record<SuggestionStatus, { mine: string; admin: string }> = {
  new: { mine: "Envoyée", admin: "À traiter" },
  accepted: { mine: "Retenue", admin: "Retenue" },
  done: { mine: "Faite", admin: "Faite" },
  declined: { mine: "Pas retenue", admin: "Pas retenue" },
};
