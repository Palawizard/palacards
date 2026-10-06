// ---------------------------------------------------------------------------
// Option « flouter les arthropodes » : repère les articles d'araignées, scorpions, acariens, insectes et
// mille-pattes d'après la description courte Wikidata (« espèce d'araignées ») et la première phrase du
// résumé (« … est une espèce de coléoptères de la famille des Carabidae »). Les crustacés restent visibles.
//
// Précision d'abord : le groupe de rock « Scorpions », le film « La Mouche » ou le fourmilier (« mangeur de
// fourmis ») ne doivent pas être floutés. Seules comptent donc les tournures qui disent ce qu'est l'article :
// « espèce de », « famille d' », « est un insecte », ou une description courte qui commence par le groupe.
// Vérifié sur une cinquantaine de vrais résumés (espèces, crustacés, homonymes). Les noms à double sens
// (« puce » de la carte SIM) ne comptent que dans une tournure taxonomique directe.
// ---------------------------------------------------------------------------

/** Groupes d'arthropodes floutés (minuscules, sans accents ; singulier et pluriel). */
const GROUPS = [
  // Arachnides
  "arachnides?",
  "araignees?",
  "araneomorphes?",
  "mygalomorphes?",
  "mygales?",
  "tarentules?",
  "scorpions?",
  "pseudoscorpions?",
  "acariens?",
  "tiques?",
  "opilions?",
  "solifuges?",
  "amblypyges?",
  "uropyges?",
  // Myriapodes
  "myriapodes?",
  "mille-pattes",
  "scolopendres?",
  "chilopodes?",
  "diplopodes?",
  "iules?",
  // Insectes et ordres courants
  "insectes?",
  "hexapodes?",
  "coleopteres?",
  "scarabees?",
  "charancons?",
  "coccinelles?",
  "lepidopteres?",
  "papillons?",
  "dipteres?",
  "mouches?",
  "moustiques?",
  "hymenopteres?",
  "fourmis",
  "abeilles?",
  "guepes?",
  "frelons?",
  "hemipteres?",
  "heteropteres?",
  "cigales?",
  "pucerons?",
  "cochenilles?",
  "orthopteres?",
  "criquets?",
  "sauterelles?",
  "grillons?",
  "odonates?",
  "libellules?",
  "blattes?",
  "blattoptera",
  "cafards?",
  "mantes?",
  "phasmes?",
  "termites?",
  "poux",
  "trichopteres?",
  "ephemeropteres?",
  "nevropteres?",
  "neuropteres?",
  "thysanopteres?",
  "dermapteres?",
  "perce-oreilles?",
  "plecopteres?",
  "mecopteres?",
  "siphonapteres?",
  "psocopteres?",
  "phtirapteres?",
  "collemboles?",
  "arthropodes?",
];
const GROUP = `(?:${GROUPS.join("|")})`;

/**
 * Noms d'arthropodes qui désignent aussi un objet courant : « carte à puce », « chenille » d'un char, « punaise »
 * (le clou), « bourdon » (la cloche). Comptés seulement juste après un rang : « espèce de puces ».
 */
const AMBIGUOUS = `(?:${["puces?", "chenilles?", "punaises?", "bourdons?"].join("|")})`;

/** Rangs taxonomiques qui introduisent un groupe (« espèce de », « famille d' », « genre fossile de »…). */
const RANK =
  "(?:especes?|sous-especes?|genres?|sous-genres?|familles?|sous-familles?|super-familles?|tribus?|sous-tribus?|ordres?|sous-ordres?|infra-ordres?|classes?|sous-classes?|clades?|taxons?)";

/** Jusqu'à deux mots entre le rang et le groupe : « espèce de petites araignées », « genre éteint d'insectes ». */
const BETWEEN = "(?:[a-z-]+ ){0,2}";
const TAXON = new RegExp(`\\b${RANK} ${BETWEEN}(?:de |d'|des |du )(?:${BETWEEN}${GROUP}|${AMBIGUOUS})\\b`);
/** « La fourmi rousse est un insecte… », « Le faucheux est une araignée… ». */
const IS_A = new RegExp(`\\b(?:est|sont) (?:un|une|des|le|la|les) (?:petite?s? |grande?s? )?${GROUP}\\b`);
/** Description qui commence par le groupe : « insecte parasite… », « araignée mythique… ». */
const STARTS_WITH = new RegExp(`^(?:petite?s? |grande?s? )?${GROUP}\\b`);
/** « nom de plusieurs sortes d'insectes », « groupe d'insectes connus… », « nom vernaculaire de certains insectes ». */
const KIND_OF = new RegExp(
  `\\b(?:sortes?|types?|groupes?|ensemble|noms?(?: vernaculaires?)?) ${BETWEEN}(?:de |d'|des )${BETWEEN}${GROUP}\\b`,
);
/** Descriptions courtes à ne pas flouter même si elles nomment un groupe (film, album, personnage…). */
const NOT_A_CREATURE =
  /\b(?:album|chanson|single|film|serie|roman|livre|bande dessinee|jeu|personnage|super-heros|constellation|navire|avion|vehicule|entreprise|marque|club|equipe|logiciel|commune|village|ville|maladie)\b/;

/** Minuscules, sans accents, apostrophes droites, espaces simples. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’ʼ`]/g, "'").replace(/\s+/g, " ").trim();
}

/** Première phrase d'un résumé (la définition de l'article) ; « L. 1758 » ou « J.-C. » ne la coupent pas. */
function firstSentence(text: string): string {
  const end = text.search(/[.;]\s+(?=\p{Lu})/u);
  return end === -1 ? text : text.slice(0, end);
}

/**
 * Article d'arthropode (hors crustacés) d'après sa description courte Wikidata et son résumé Wikipédia.
 * Sans description ni résumé : non (rien à flouter, l'image arrive avec eux).
 */
export function isArthropod(summary: { description?: string | null; extract?: string | null }): boolean {
  const description = normalize(summary.description ?? "");
  if (description && !NOT_A_CREATURE.test(description)) {
    if (TAXON.test(description) || STARTS_WITH.test(description) || KIND_OF.test(description)) return true;
  }
  const extract = normalize(firstSentence(summary.extract ?? ""));
  return !!extract && (TAXON.test(extract) || IS_A.test(extract));
}
