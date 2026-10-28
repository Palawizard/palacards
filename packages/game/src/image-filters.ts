// ---------------------------------------------------------------------------
// Filtres d'images (suggestion n° 111) : thèmes que chaque joueur peut flouter, chacun avec son interrupteur.
// - « arthropodes » : l'option d'origine (voir arthropod.ts), détectée d'après le résumé ;
// - « blessures, gore et maladies » et « nudité » : membres de catégories Wikipédia choisies (rechargés par un job,
//   comme les genres « bizarres » du fil) et indices du résumé en cache, sur le modèle d'isArthropod.
// La liste gérée dans Admin l'emporte toujours (ajouter ou retirer une carte d'un thème).
//
// Précision d'abord : seules les tournures qui disent ce qu'est l'article comptent (« est une maladie… », une
// description courte qui commence par « maladie de la peau »), jamais une simple mention (« mort de la tuberculose »).
// La nudité se lit mal dans un résumé (un tableau de Vénus ne dit pas qu'elle est nue) : les catégories y font
// l'essentiel.
// ---------------------------------------------------------------------------

import { isArthropod } from "./arthropod.js";

export const IMAGE_THEMES = ["arthropods", "gore", "nudity"] as const;
export type ImageTheme = (typeof IMAGE_THEMES)[number];

/** Nom du thème dans les Paramètres et dans Admin. */
export const IMAGE_THEME_LABELS: Record<ImageTheme, string> = {
  arthropods: "Arthropodes",
  gore: "Blessures, gore et maladies",
  nudity: "Nudité",
};

/** Mention sur une image floutée (celle des arthropodes ne change pas). */
export const IMAGE_THEME_VEILS: Record<ImageTheme, string> = {
  arthropods: "Arthropode masqué",
  gore: "Image sensible masquée",
  nudity: "Nudité masquée",
};

/** Catégorie Wikipédia lue par le job, et la profondeur de sous-catégories parcourue. */
export interface FilterCategory {
  name: string;
  depth: number;
}

/**
 * Catégories des thèmes détectés par catégorie. Vérifiées le 28/10/2026 sur fr.wikipedia.org : « Médecine légale »
 * et « Chirurgie » entières ramenaient surtout des personnes et des instituts, d'où des sous-catégories choisies.
 */
export const IMAGE_FILTER_CATEGORIES: Record<Exclude<ImageTheme, "arthropods">, FilterCategory[]> = {
  gore: [
    { name: "Maladie de la peau", depth: 2 },
    { name: "Maladie en dermatologie", depth: 1 },
    { name: "Lésion élémentaire en dermatologie", depth: 1 },
    { name: "Lésion", depth: 2 },
    { name: "Gangrène", depth: 1 },
    { name: "Autopsie", depth: 0 },
    { name: "Momie", depth: 1 },
    { name: "Traitement chirurgical", depth: 1 },
    { name: "Transplantation médicale", depth: 1 },
    { name: "Maladie infectieuse", depth: 1 },
  ],
  nudity: [
    { name: "Nu féminin", depth: 2 },
    { name: "Nu masculin", depth: 2 },
    { name: "Nudité", depth: 1 },
    { name: "Nudité dans l'art et la culture", depth: 1 },
    { name: "Naturisme", depth: 1 },
    { name: "Nudisme", depth: 1 },
    { name: "Anatomie du système génital", depth: 2 },
    { name: "Pornographie", depth: 1 },
    { name: "Média pornographique", depth: 1 },
  ],
};

/**
 * Sous-catégories jamais parcourues : personnes (portraits), histoire, fiction, films, entreprises, listes… Leurs
 * images n'ont rien de choquant (« Mort d'une maladie infectieuse », « Mort liée à une opération chirurgicale »,
 * « Dermatologue », « Playmate »).
 */
export const IMAGE_FILTER_SKIP_SUBCATEGORY =
  /^(?:Personnalit|Chirurgien|Dermatologue|Infectiologue|Histoire|Liste|Wikipédia|Mort|Décès|Film|Œuvre|Entreprise|Récompense|Opposition|Revue|Médicament|Matériel|Ressource|Dépistage|Discipline|Isolement|Agent infectieux|Cas de|Calendrier|Penthouse|Playmate|Pin-up|Pieds nus|Parodie|Terminologie|Salon|Pornographie (?:féministe|LGBT|par pays)|Naturisme par pays|Tourisme|Dermatoxine|Onguent|Physiologie|Vénérologie|Cellule|Tumeur)|dans la fiction|dans l'art et la culture|et protestation/i;

/** Minuscules, sans accents, apostrophes droites, espaces simples. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’ʼ`]/g, "'").replace(/\s+/g, " ").trim();
}

/** Première phrase d'un résumé (la définition de l'article). */
function firstSentence(text: string): string {
  const end = text.search(/[.;]\s+(?=\p{Lu})/u);
  return end === -1 ? text : text.slice(0, end);
}

/** Œuvres, lieux, personnes… : une description courte de ce genre n'est jamais une maladie ni une plaie. */
const NOT_A_CONDITION =
  /\b(?:album|chanson|single|film|serie|roman|livre|bande dessinee|jeu|personnage|groupe|chanteu|acteur|actrice|ecrivain|journal|revue|navire|entreprise|marque|club|equipe|logiciel|commune|village|ville|episode|association|organisation|fondation|hopital|institut|musee|medecin|chirurgien|virus|bacterie|genre|espece)\b/;

/** Ce qui se voit sur l'image : maladies (surtout de peau), plaies, chirurgie, cadavres. */
const GORE_HEAD =
  "(?:maladie|infection|affection|dermatose|dermatite|lesion|plaie|blessure|brulure|ulcere|ulceration|gangrene|necrose|abces|eruption cutanee|tumeur cutanee|malformation|intervention chirurgicale|operation chirurgicale|acte chirurgical|technique chirurgicale|procedure chirurgicale|chirurgie|amputation|greffe|transplantation|autopsie|cadavre|momie|corps momifie|depouille)";
/** Description courte qui commence par le groupe : « maladie de la peau », « lésion cutanée ». */
const GORE_STARTS = new RegExp(`^(?:une? |la |le |l')?(?:(?:rare|grave|ancienne?) )?${GORE_HEAD}\\b`);
/** « La gale est une maladie… », « L'appendicectomie est une intervention chirurgicale… ». */
const GORE_IS_A = new RegExp(
  `\\b(?:est|sont|etait) (?:un|une|des|le|la|les|l') ?(?:(?:petite?s?|grave|rare|frequente|forme|sorte|type) (?:de |d')?)?${GORE_HEAD}\\b`,
);

/** Maladies des plantes (une feuille tachée n'a rien de choquant). */
const PLANT_DISEASE =
  /\bmaladies? (?:\w+ )?(?:des|de la|du|de l') ?(?:plantes?|vegetaux|arbres?|vigne|cultures?|ble|mais|pommes? de terre|agrumes|cereales|hetres?|chenes?|pins?|ormes?|chataigniers?|platanes?|frenes?|peupliers?|cypres|palmiers?)\b|\b(?:phytopatholog\w*|cryptogamique)\b/;

/**
 * Article de maladie, de plaie, de chirurgie ou de cadavre d'après sa description courte (Wikidata) et la première
 * phrase de son résumé.
 */
export function isGore(summary: { description?: string | null; extract?: string | null }): boolean {
  const description = normalize(summary.description ?? "");
  const extract = normalize(firstSentence(summary.extract ?? ""));
  if (description && NOT_A_CONDITION.test(description)) return false;
  if (PLANT_DISEASE.test(description) || PLANT_DISEASE.test(extract)) return false;
  if (description && GORE_STARTS.test(description)) return true;
  return !!extract && GORE_IS_A.test(extract);
}

/** Œuvre ou photographie de nu : « tableau représentant une femme nue », « nu féminin ». */
const NUDE_WORD = "(?:nue?s?|nudite|denude(?:e|s|es)?|deshabille(?:e|s|es)?)";
const ARTWORK = "(?:tableau|peinture|toile|sculpture|statue|statuette|photographie|dessin|gravure|fresque|estampe)";
const NUDE_ART = new RegExp(`\\b${ARTWORK}\\b.*\\b${NUDE_WORD}\\b`);
/** Description courte qui commence par le nu : « nu féminin de Modigliani ». */
const NUDE_STARTS = new RegExp(`^${NUDE_WORD}\\b`);
/** Musique, livres, jeux : un titre ou un résumé qui parle de nu n'en montre pas. */
const NOT_AN_IMAGE = /\b(?:chanson|single|album|roman|livre|nouvelle|serie|jeu video|episode|emission|groupe)\b/;
/** Naturisme, pornographie (œuvres et médias, pas les personnes), organes génitaux. */
const NUDITY_TOPIC =
  /\b(?:naturisme|naturiste|nudisme|nudiste|film pornographique|magazine pornographique|site (?:web )?pornographique|revue erotique|organes? genita(?:l|ux)|appareil genital)\b/;
/** Personnes : leur photo n'est jamais un nu, même pour une actrice de films pour adultes. */
const A_PERSON =
  /\b(?:acteur|actrice|realisat(?:eur|rice)|mannequin|modele|chanteu(?:r|se)|peintre|sculpteur|photographe|ecrivain|personnalite|joueu(?:r|se)|homme|femme) (?:politique|pornographique|americain|americaine|francais|francaise|ne|nee)\b|^(?:acteur|actrice|mannequin|chanteur|chanteuse|ecrivain|peintre|sculpteur|photographe)\b/;

/** Article de nu (œuvre, photographie), de naturisme, de pornographie ou d'anatomie génitale, d'après le résumé. */
export function isNudity(summary: { description?: string | null; extract?: string | null }): boolean {
  const description = normalize(summary.description ?? "");
  const extract = normalize(firstSentence(summary.extract ?? ""));
  if (description && (A_PERSON.test(description) || NOT_AN_IMAGE.test(description))) return false;
  if (NUDE_STARTS.test(description)) return true;
  return [description, extract].some((t) => !!t && (NUDE_ART.test(t) || NUDITY_TOPIC.test(t)));
}

/** Thèmes repérés d'après le résumé seul (les catégories et la liste Admin s'y ajoutent côté serveur). */
export function summaryImageThemes(summary: { description?: string | null; extract?: string | null }): ImageTheme[] {
  const out: ImageTheme[] = [];
  if (isArthropod(summary)) out.push("arthropods");
  if (isGore(summary)) out.push("gore");
  if (isNudity(summary)) out.push("nudity");
  return out;
}

/** Thèmes d'une carte : ceux repérés, sauf ce que la liste Admin retire, plus ce qu'elle ajoute (elle l'emporte). */
export function resolveImageThemes(detected: Iterable<ImageTheme>, overrides: Map<ImageTheme, boolean>): ImageTheme[] {
  const out = new Set(detected);
  for (const [theme, flagged] of overrides) {
    if (flagged) out.add(theme);
    else out.delete(theme);
  }
  return IMAGE_THEMES.filter((t) => out.has(t));
}
