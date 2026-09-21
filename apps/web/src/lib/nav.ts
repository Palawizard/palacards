export interface NavItem {
  slug: string;
  label: string;
  description: string;
}

/** Les 13 entrées du menu + Admin (voir docs/ « Toutes les pages »). */
export const NAV: NavItem[] = [
  { slug: "pulls", label: "Paquets", description: "Ouvrir des paquets de 5 cartes." },
  { slug: "collection", label: "Collection", description: "Tes cartes, filtres, fusion et recyclage." },
  { slug: "trades", label: "Échanges", description: "Troc de cartes et de PW entre joueurs." },
  { slug: "market", label: "Marché", description: "Enchères en direct avec anti-snipe." },
  { slug: "profile", label: "Profil", description: "Vitrine, score de collection, Elo." },
  { slug: "cards", label: "Toutes les cartes", description: "Catalogue des 2,7 M articles." },
  { slug: "guild", label: "Guilde", description: "Membres, chat, objectifs communs." },
  { slug: "friends", label: "Amis", description: "Demandes et statut en ligne." },
  { slug: "messages", label: "Messages", description: "Messages privés en temps réel." },
  { slug: "battle", label: "Bataille", description: "Duels quiz + stats, direct ou asynchrone." },
  { slug: "achievements", label: "Succès", description: "Progression et récompenses." },
  { slug: "leaderboard", label: "Classement", description: "Collection, Elo, richesse, guildes." },
  { slug: "settings", label: "Paramètres", description: "Compte, notifications, animations." },
  { slug: "admin", label: "Admin", description: "Paquets, PW, saisons, logs." },
];
