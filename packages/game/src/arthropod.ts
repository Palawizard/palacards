// ---------------------------------------------------------------------------
// Option « flouter les arthropodes » : repère les articles d'araignées, scorpions, acariens, insectes et
// mille-pattes d'après la description courte Wikidata (« espèce d'araignées ») et la première phrase du
// résumé (« … est une espèce de coléoptères de la famille des Carabidae »). Les crustacés restent visibles.
//
// Précision d'abord : un groupe de rock « Scorpions » ou le film « La Mouche » ne doivent pas être floutés.
// Dans le résumé, seules comptent donc les tournures taxonomiques (« espèce de », « famille d' »…) et
// « est un insecte ». La description courte, elle, ne parle que de l'article : un nom de groupe y suffit.
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
  "chenilles?",
  "dipteres?",
  "mouches?",
  "moustiques?",
  "hymenopteres?",
  "fourmis",
  "abeilles?",
  "guepes?",
  "frelons?",
  "bourdons?",
  "hemipteres?",
  "heteropteres?",
  "punaises?",
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
  "puces?",
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

/** Rangs taxonomiques qui introduisent un groupe (« espèce de », « famille d' », « genre fossile de »…). */
const RANK =
  "(?:especes?|sous-especes?|genres?|sous-genres?|familles?|sous-familles?|super-familles?|tribus?|sous-tribus?|ordres?|sous-ordres?|infra-ordres?|classes?|sous-classes?|clades?|taxons?)";

/** Jusqu'à deux mots entre le rang et le groupe : « espèce de petites araignées », « genre éteint d'insectes ». */
const BETWEEN = "(?:[a-z-]+ ){0,2}";
const TAXON = new RegExp(`\\b${RANK} ${BETWEEN}(?:de |d'|des |du )${BETWEEN}${GROUP}\\b`);
/** « La fourmi rousse est un insecte… », « Le faucheux est une araignée… ». */
const IS_A = new RegExp(`\\b(?:est|sont) (?:un|une|des|le|la|les) (?:petite?s? |grande?s? )?${GROUP}\\b`);
const IN_DESCRIPTION = new RegExp(`(?:^|[^a-z-])${GROUP}(?:$|[^a-z-])`);
/** Descriptions courtes à ne pas flouter même si elles nomment un groupe (« groupe de hard rock », film…). */
const NOT_A_CREATURE =
  /\b(?:groupe|album|chanson|single|film|serie|roman|livre|bande dessinee|jeu|personnage|super-heros|constellation|navire|avion|vehicule|entreprise|marque|club|equipe|logiciel|commune|village|ville|maladie)\b/;

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
    if (TAXON.test(description) || IN_DESCRIPTION.test(description)) return true;
  }
  const extract = normalize(firstSentence(summary.extract ?? ""));
  return !!extract && (TAXON.test(extract) || IS_A.test(extract));
}
