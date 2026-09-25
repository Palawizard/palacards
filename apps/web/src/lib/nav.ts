import {
  Award,
  Gavel,
  Layers,
  LibraryBig,
  MessageSquare,
  Package,
  Repeat,
  Settings,
  Shield,
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
  /** Badge de non-lus alimenté par /me. */
  badge?: "messages";
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
      { href: "/pulls", label: "Paquets", icon: Package },
      { href: "/collection", label: "Collection", icon: Layers },
      { href: "/cards", label: "Toutes les cartes", icon: LibraryBig },
      { href: "/battle", label: "Bataille", icon: Swords },
    ],
  },
  {
    title: "Commerce",
    items: [
      { href: "/market", label: "Marché", icon: Gavel },
      { href: "/trades", label: "Échanges", icon: Repeat },
    ],
  },
  {
    title: "Communauté",
    items: [
      { href: "/friends", label: "Amis", icon: Users },
      { href: "/messages", label: "Messages", icon: MessageSquare, badge: "messages" },
      { href: "/guild", label: "Guilde", icon: Shield },
      { href: "/leaderboard", label: "Classement", icon: Trophy },
    ],
  },
  {
    title: "Moi",
    items: [
      { href: "/profile", label: "Profil", icon: UserRound },
      { href: "/achievements", label: "Succès", icon: Award },
      { href: "/settings", label: "Paramètres", icon: Settings },
      { href: "/admin", label: "Admin", icon: Wrench, admin: true },
    ],
  },
];
