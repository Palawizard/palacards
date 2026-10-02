// ---------------------------------------------------------------------------
// Fil d'activité : les « cartes bizarres ». Un tirage est rangé dans un genre si son article est dans
// une catégorie Wikipédia du genre (liste rechargée en tâche de fond) ou si son titre contient un mot-clé.
// ---------------------------------------------------------------------------

export interface WeirdGenre {
  key: string;
  label: string;
  emoji: string;
  /** Catégories Wikipédia FR (sans « Catégorie: »), parcourues sur un niveau de sous-catégories. */
  categories: string[];
  /** Mots-clés cherchés dans le titre (sans accents, en minuscules). */
  keywords: RegExp;
}

export const WEIRD_GENRES: WeirdGenre[] = [
  {
    key: "sexe",
    label: "Sous la ceinture",
    emoji: "🍑",
    categories: [
      "Sexualité humaine",
      "Pratique sexuelle",
      "Pornographie",
      "Paraphilie",
      "Prostitution",
      "Érotisme",
      "Fétichisme sexuel",
    ],
    keywords:
      /\b(sexe|sexuel\w*|sexualit\w*|porno\w*|erot\w*|orgasm\w*|penis|vagin\w*|clitoris|masturb\w*|prostitu\w*|fetich\w*|sodomie|fellation|cunnilingus|libido|aphrodisiaque|preservatif|godemiche|bordel|strip-?tease|kamasutra|bdsm|echangisme|partouze|lingerie)\b/,
  },
  {
    key: "ww2",
    label: "Seconde Guerre mondiale",
    emoji: "🪖",
    categories: [
      "Seconde Guerre mondiale",
      "Nazisme",
      "Shoah",
      "Camp de concentration nazi",
      "Collaboration pendant la Seconde Guerre mondiale",
      "Résistance française",
      "Waffen-SS",
    ],
    keywords:
      /\b(nazi\w*|hitler|wehrmacht|gestapo|waffen|luftwaffe|kriegsmarine|panzer|shoah|holocauste|reich|vichy|petain|debarquement|blitzkrieg|kamikaze|stalingrad|auschwitz|oradour)\b|seconde guerre mondiale|camp de concentration/,
  },
  {
    key: "mort",
    label: "Crimes et morts",
    emoji: "💀",
    categories: [
      "Tueur en série",
      "Cannibalisme",
      "Méthode d'exécution",
      "Torture",
      "Massacre",
      "Mort insolite",
      "Affaire criminelle en France",
    ],
    keywords:
      /\b(meurtre\w*|assassin\w*|tueur\w*|cannibal\w*|execution|guillotine|pendaison|torture\w*|massacre\w*|suicide\w*|cadavre\w*|necro\w*|homicide\w*|empoisonn\w*|bourreau|decapit\w*|crucifi\w*|autopsie|morgue|cimetiere|catacombe\w*|charnier)\b/,
  },
  {
    key: "paranormal",
    label: "Paranormal et complots",
    emoji: "👽",
    categories: [
      "Paranormal",
      "Cryptozoologie",
      "Théorie du complot",
      "Ufologie",
      "Fantôme",
      "Sorcellerie",
      "Satanisme",
    ],
    keywords:
      /\b(fantome\w*|ovni\w*|extraterrestre\w*|complot\w*|illuminati|sorcell\w*|sorcier\w*|demon\w*|satan\w*|diable|zombie\w*|vampire\w*|loup-garou|yeti|exorcis\w*|possession|spirite\w*|hante\w*|maudit\w*|malediction|poltergeist|chupacabra|reptilien\w*)\b|triangle des bermudes|monstre du loch ness/,
  },
  {
    key: "corps",
    label: "Pipi-caca",
    emoji: "💩",
    categories: ["Excrément", "Scatologie", "Flatulence", "Toilettes"],
    keywords:
      /\b(excrement\w*|merde|caca|crotte\w*|fiente\w*|flatulence\w*|pet|pets|prout|vomi\w*|urine\w*|pipi|diarrhee|constipation|toilette\w*|latrine\w*|chiotte\w*|morve|crachat|furoncle|verrue|hemorroide\w*|ver solitaire|tenia|pou|poux|punaise\w*)\b/,
  },
  {
    key: "insolite",
    label: "Insolite",
    emoji: "🤡",
    categories: ["Phénomène Internet", "Canular", "Mème Internet", "Record"],
    keywords:
      /\b(canular\w*|absurde|insolite|bizarre|parodie|meme|loufoque|farce|nanar\w*|kitsch|ridicule)\b|poisson d'avril/,
  },
];

export const WEIRD_GENRE_KEYS = WEIRD_GENRES.map((g) => g.key);

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Genres « bizarres » d'un titre d'après ses mots-clés. */
export function weirdGenresOfTitle(title: string): string[] {
  const t = plain(title);
  return WEIRD_GENRES.filter((g) => g.keywords.test(t)).map((g) => g.key);
}

/** Réactions possibles sur un tirage du fil. */
export const FEED_REACTIONS = ["🔥", "😂", "😱", "🤢", "👑"] as const;
export type FeedReaction = (typeof FEED_REACTIONS)[number];
