// ---------------------------------------------------------------------------
// Portfolios (suggestions n° 3 et 116) : des sélections de cartes possédées, mises en page et décorées, à montrer
// sur une page publique et jusqu'à trois sur son profil. Les likes ne rapportent rien.
//
// Designs : un fond, un cadre et une couleur d'accent par portfolio. Quatre sources : gratuits pour tous, gagnés
// par un succès ou un évènement, achetés en PW (cosmétiques, une seule fois), ou image envoyée par le joueur (fond).
// ---------------------------------------------------------------------------

/** Garde-fou technique (pas de limite côté jeu). */
export const PORTFOLIO_MAX = 50;
export const PORTFOLIO_CARDS_MAX = 30;
/** Portfolios affichés sur le profil, dans l'ordre choisi. */
export const PORTFOLIO_PROFILE_SLOTS = 3;
export const PORTFOLIO_NAME_MAX = 40;
export const PORTFOLIO_DESCRIPTION_MAX = 280;
/** Cartes en vedette (agrandies) par portfolio. */
export const PORTFOLIO_FEATURED_MAX = 1;

export type PortfolioDesignSlot = "background" | "frame";

/** Comment on obtient un design. */
export type PortfolioDesignSource =
  | { kind: "free" }
  | { kind: "shop"; price: number }
  | { kind: "achievement"; achievement: string; label: string }
  | { kind: "event"; label: string; from: string; to: string };

export interface PortfolioDesign {
  key: string;
  slot: PortfolioDesignSlot;
  name: string;
  source: PortfolioDesignSource;
}

const free = { kind: "free" } as const;
const shop = (price: number) => ({ kind: "shop", price }) as const;

/** Prix en PW : fonds, cadres, prestige (un booster à thème vaut 250 PW). */
export const PORTFOLIO_PRICES = { background: 300, frame: 600, prestige: 1_500 } as const;

/** Halloween 2026 : un assaut contre le boss entre ces deux jours (heure de Paris, inclus). */
export const HALLOWEEN_2026 = { from: "2026-10-31", to: "2026-11-09" } as const;
const halloween = {
  kind: "event",
  label: "Un assaut contre le boss entre le 31 octobre et le 9 novembre 2026",
  ...HALLOWEEN_2026,
} as const;

export const PORTFOLIO_DESIGNS: PortfolioDesign[] = [
  // Fonds
  { key: "papier", slot: "background", name: "Papier", source: free },
  { key: "ardoise", slot: "background", name: "Ardoise", source: free },
  { key: "lin", slot: "background", name: "Lin", source: free },
  { key: "nuit", slot: "background", name: "Nuit", source: free },
  { key: "citrouille", slot: "background", name: "Citrouille", source: halloween },
  {
    key: "prisme",
    slot: "background",
    name: "Prisme",
    source: { kind: "achievement", achievement: "shiny_1", label: "Succès « Brillantes », palier I" },
  },
  {
    key: "encyclopedie",
    slot: "background",
    name: "Encyclopédie",
    source: {
      kind: "achievement",
      achievement: "collection_10000",
      label: "Succès « Articles différents », palier IV",
    },
  },
  { key: "marbre", slot: "background", name: "Marbre", source: shop(PORTFOLIO_PRICES.background) },
  { key: "velours", slot: "background", name: "Velours", source: shop(PORTFOLIO_PRICES.background) },
  { key: "carte-ancienne", slot: "background", name: "Carte ancienne", source: shop(PORTFOLIO_PRICES.background) },
  { key: "galaxie", slot: "background", name: "Galaxie", source: shop(PORTFOLIO_PRICES.prestige) },
  // Cadres
  { key: "filet", slot: "frame", name: "Filet", source: free },
  { key: "double-filet", slot: "frame", name: "Double filet", source: free },
  { key: "pointilles", slot: "frame", name: "Pointillés", source: free },
  { key: "citrouille-cadre", slot: "frame", name: "Citrouille", source: halloween },
  {
    key: "or-legendaire",
    slot: "frame",
    name: "Or légendaire",
    source: { kind: "achievement", achievement: "first_l", label: "Succès « Légendaires », palier I" },
  },
  {
    key: "trophee",
    slot: "frame",
    name: "Trophée",
    source: { kind: "achievement", achievement: "boss_kill_30", label: "Succès « Boss vaincus », palier III" },
  },
  {
    key: "assidu",
    slot: "frame",
    name: "Assidu",
    source: { kind: "achievement", achievement: "weekly_12", label: "Succès « Quêtes de la semaine », palier III" },
  },
  { key: "laiton", slot: "frame", name: "Laiton", source: shop(PORTFOLIO_PRICES.frame) },
  { key: "bois-sculpte", slot: "frame", name: "Bois sculpté", source: shop(PORTFOLIO_PRICES.frame) },
  { key: "holographique", slot: "frame", name: "Holographique", source: shop(PORTFOLIO_PRICES.prestige) },
];

export const PORTFOLIO_DESIGN_BY_KEY = new Map(PORTFOLIO_DESIGNS.map((d) => [d.key, d]));

/** Fond « image envoyée par le joueur » (pas dans le catalogue : gratuit, un par portfolio). */
export const PORTFOLIO_IMAGE_BACKGROUND = "image";

/** Couleurs d'accent, toutes gratuites (titre, carte en vedette, likes). */
export const PORTFOLIO_ACCENTS = [
  { key: "or", name: "Or" },
  { key: "corail", name: "Corail" },
  { key: "rubis", name: "Rubis" },
  { key: "prune", name: "Prune" },
  { key: "azur", name: "Azur" },
  { key: "lagon", name: "Lagon" },
  { key: "sauge", name: "Sauge" },
  { key: "encre", name: "Encre" },
] as const;
export type PortfolioAccent = (typeof PORTFOLIO_ACCENTS)[number]["key"];
export const PORTFOLIO_ACCENT_KEYS = PORTFOLIO_ACCENTS.map((a) => a.key) as [PortfolioAccent, ...PortfolioAccent[]];

export const PORTFOLIO_DEFAULTS = { background: "papier", frame: "filet", accent: "or" } as const;

/**
 * Designs d'un joueur : les gratuits, ceux qu'il a achetés ou gagnés (`owned`), et ceux auxquels il a droit
 * maintenant (succès débloqués, évènement joué), qu'il faut alors lui enregistrer.
 */
export function eligibleDesigns(input: {
  owned: Iterable<string>;
  unlockedAchievements: Set<string>;
  /** Jours (Paris) où le joueur a lancé un assaut contre le boss pendant un évènement. */
  eventPlayed: (from: string, to: string) => boolean;
}): { have: Set<string>; earned: { key: string; source: "achievement" | "event" }[] } {
  const have = new Set(input.owned);
  const earned: { key: string; source: "achievement" | "event" }[] = [];
  for (const d of PORTFOLIO_DESIGNS) {
    if (d.source.kind === "free") have.add(d.key);
    else if (have.has(d.key)) continue;
    else if (d.source.kind === "achievement" && input.unlockedAchievements.has(d.source.achievement)) {
      have.add(d.key);
      earned.push({ key: d.key, source: "achievement" });
    } else if (d.source.kind === "event" && input.eventPlayed(d.source.from, d.source.to)) {
      have.add(d.key);
      earned.push({ key: d.key, source: "event" });
    }
  }
  return { have, earned };
}

/**
 * Ordre d'un portfolio : les cartes dans l'ordre voulu, sans doublon, au plus PORTFOLIO_CARDS_MAX, avec au plus
 * PORTFOLIO_FEATURED_MAX en vedette (la première demandée). Renvoie null si l'ordre est invalide.
 */
export function normalizePortfolioCards(
  cards: { instanceId: number; featured?: boolean }[],
): { instanceId: number; featured: boolean }[] | null {
  const seen = new Set<number>();
  for (const c of cards) {
    if (seen.has(c.instanceId)) return null;
    seen.add(c.instanceId);
  }
  if (cards.length > PORTFOLIO_CARDS_MAX) return null;
  let featured = 0;
  return cards.map((c) => {
    const on = !!c.featured && featured < PORTFOLIO_FEATURED_MAX;
    if (on) featured++;
    return { instanceId: c.instanceId, featured: on };
  });
}

// ---------------------------------------------------------------------------
// Portfolios partagés (suggestion n° 125) : le propriétaire invite des amis, qui y ajoutent leurs propres cartes.
// Aucune carte ne change de main : chacune reste à celui qui l'a posée et sort du portfolio s'il le quitte.
// ---------------------------------------------------------------------------

/** Joueurs au plus dans un portfolio partagé, propriétaire et invitations en attente compris. */
export const PORTFOLIO_SHARED_MAX_PLAYERS = 10;

/** Qui voit le portfolio : tout le monde (page Communauté, profils) ou ses participants seuls. */
export const PORTFOLIO_VISIBILITIES = ["public", "members"] as const;
export type PortfolioVisibility = (typeof PORTFOLIO_VISIBILITIES)[number];

/**
 * Droits d'un invité, choisis par le propriétaire (contributeur à l'invitation) :
 * - `contributor` : ajoute et retire ses propres cartes, sans toucher à l'ordre ni à la vedette ;
 * - `editor` : comme le propriétaire pour les cartes (ordre, vedette, retrait des cartes de tous).
 * Titre, description, design, partage et visibilité restent au propriétaire.
 */
export const PORTFOLIO_MEMBER_ROLES = ["contributor", "editor"] as const;
export type PortfolioMemberRole = (typeof PORTFOLIO_MEMBER_ROLES)[number];
export const PORTFOLIO_MEMBER_ROLE_LABELS: Record<PortfolioMemberRole, string> = {
  contributor: "Contributeur",
  editor: "Éditeur",
};

/** Ce qu'un joueur peut faire des cartes d'un portfolio : propriétaire, éditeur ou contributeur. */
export type PortfolioRights = "owner" | PortfolioMemberRole;

/** Ordre, vedette et retrait des cartes de tous : propriétaire et éditeurs. */
export const arrangesPortfolio = (rights: PortfolioRights | null) => rights === "owner" || rights === "editor";

/**
 * Nouvelles cartes demandées par un participant, appliquées selon ses droits.
 * - Propriétaire et éditeur : la liste demandée telle quelle.
 * - Contributeur : seules ses additions (à la fin, hors vedette) et ses retraits comptent ; l'ordre et la vedette
 *   des cartes déjà là restent ceux du portfolio, même si sa page n'était plus à jour.
 * Renvoie null si un contributeur retire une carte qui n'est pas à lui. `added` est à vérifier dans sa collection.
 */
export function portfolioCardsChange(input: {
  editorId: string;
  rights: PortfolioRights;
  before: { instanceId: number; ownerId: string; featured: boolean }[];
  after: { instanceId: number; featured: boolean }[];
}): { added: number[]; removed: number[]; cards: { instanceId: number; featured: boolean }[] } | null {
  const next = new Set(input.after.map((c) => c.instanceId));
  const known = new Set(input.before.map((c) => c.instanceId));
  const removed = input.before.filter((c) => !next.has(c.instanceId));
  const added = input.after.filter((c) => !known.has(c.instanceId));
  const out = { added: added.map((c) => c.instanceId), removed: removed.map((c) => c.instanceId) };
  if (arrangesPortfolio(input.rights)) return { ...out, cards: input.after };
  if (removed.some((c) => c.ownerId !== input.editorId)) return null;
  return {
    ...out,
    cards: [
      ...input.before
        .filter((c) => next.has(c.instanceId))
        .map((c) => ({ instanceId: c.instanceId, featured: c.featured })),
      ...added.map((c) => ({ instanceId: c.instanceId, featured: false })),
    ],
  };
}
