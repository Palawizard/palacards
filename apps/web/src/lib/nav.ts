import {
  ArrowBigUpDash,
  Award,
  CircleDot,
  Gavel,
  Heart,
  Inbox,
  Layers,
  Lightbulb,
  LibraryBig,
  MessageSquare,
  Newspaper,
  Package,
  Puzzle,
  Radio,
  Repeat,
  Settings,
  Shield,
  Skull,
  Stamp,
  Swords,
  Trophy,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Badge alimenté par /me : non-lus, roue prête, paquets à ouvrir, quêtes, article, boss, file des duels. */
  badge?: "messages" | "wheel" | "packs" | "quests" | "article" | "boss" | "suggestions" | "battle";
  /** Clé de nouveauté (`/me.newFeatures`) : pastille « Nouveau » jusqu'à la première visite. */
  feature?: string;
  admin?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Menu « portail », groupé comme la colonne latérale de Wikipédia (voir docs « Toutes les pages »). */
export const NAV: NavGroup[] = [
  {
    title: "Jouer",
    items: [
      { href: "/pulls", label: "Paquets", icon: Package, badge: "packs" },
      { href: "/quests", label: "Quêtes et passe", icon: Stamp, badge: "quests", feature: "quests" },
      { href: "/wheel", label: "Roues du jour", icon: CircleDot, badge: "wheel", feature: "wheels" },
      { href: "/article", label: "Article du jour", icon: Puzzle, badge: "article", feature: "article-v2" },
      { href: "/boss", label: "Boss du jour", icon: Skull, badge: "boss", feature: "boss-v2" },
      { href: "/collection", label: "Collection", icon: Layers },
      { href: "/upgrade", label: "Upgrader", icon: ArrowBigUpDash },
      { href: "/cards", label: "Toutes les cartes", icon: LibraryBig },
      { href: "/battle", label: "Bataille", icon: Swords, badge: "battle", feature: "battle-decks" },
    ],
  },
  {
    title: "Commerce",
    items: [
      { href: "/market", label: "Marché", icon: Gavel },
      { href: "/trades", label: "Échanges", icon: Repeat },
      { href: "/wishlist", label: "Wishlist", icon: Heart },
    ],
  },
  {
    title: "Communauté",
    items: [
      { href: "/friends", label: "Amis", icon: Users },
      { href: "/messages", label: "Messages", icon: MessageSquare, badge: "messages" },
      { href: "/feed", label: "Fil d'activité", icon: Radio, feature: "feed" },
      { href: "/guild", label: "Guilde", icon: Shield },
      { href: "/leaderboard", label: "Classement", icon: Trophy },
      { href: "/nouveautes", label: "Mises à jour", icon: Newspaper, feature: "updates" },
      { href: "/suggestions", label: "Suggestions", icon: Lightbulb, feature: "suggestions" },
    ],
  },
  {
    title: "Moi",
    items: [
      { href: "/profile", label: "Profil", icon: UserRound },
      { href: "/achievements", label: "Succès", icon: Award, feature: "achievements-v2" },
      { href: "/settings", label: "Paramètres", icon: Settings },
      { href: "/admin", label: "Admin", icon: Wrench, admin: true },
      { href: "/admin/suggestions", label: "Suggestions reçues", icon: Inbox, admin: true, badge: "suggestions" },
    ],
  },
];
