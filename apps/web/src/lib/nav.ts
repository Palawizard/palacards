import {
  ArrowBigUpDash,
  Award,
  CircleDot,
  Gavel,
  Heart,
  Layers,
  LibraryBig,
  MessageSquare,
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
  /** Badge alimenté par /me : non-lus, roue prête, paquets à ouvrir, quêtes, article, boss. */
  badge?: "messages" | "wheel" | "packs" | "quests" | "article" | "boss";
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
      { href: "/wheel", label: "Roue du jour", icon: CircleDot, badge: "wheel" },
      { href: "/article", label: "Article du jour", icon: Puzzle, badge: "article", feature: "article" },
      { href: "/boss", label: "Boss du jour", icon: Skull, badge: "boss", feature: "boss" },
      { href: "/collection", label: "Collection", icon: Layers },
      { href: "/upgrade", label: "Upgrader", icon: ArrowBigUpDash },
      { href: "/cards", label: "Toutes les cartes", icon: LibraryBig },
      { href: "/battle", label: "Bataille", icon: Swords, feature: "battle-v2" },
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
    ],
  },
  {
    title: "Moi",
    items: [
      { href: "/profile", label: "Profil", icon: UserRound },
      { href: "/achievements", label: "Succès", icon: Award, feature: "achievements-v2" },
      { href: "/settings", label: "Paramètres", icon: Settings },
      { href: "/admin", label: "Admin", icon: Wrench, admin: true },
    ],
  },
];
