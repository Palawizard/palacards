import { descriptionHead } from "./battle.js";

// ---------------------------------------------------------------------------
// Catégorie d'un article (boss du jour : faiblesse et résistance ; article du jour : attribut « Catégorie »),
// d'après le début de sa description courte Wikidata (« acteur américain », « commune française »,
// « film de Christopher Nolan »…). Table de mots-clés, quelques débuts en deux mots pour les cas ambigus,
// et repli « autre ».
// ---------------------------------------------------------------------------

export const ARTICLE_CATEGORIES = ["personne", "lieu", "oeuvre", "organisation", "autre"] as const;
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ArticleCategory, string> = {
  personne: "Personne",
  lieu: "Lieu",
  oeuvre: "Œuvre",
  organisation: "Organisation",
  autre: "Autre",
};

const words = (list: string) => list.split(/\s+/).filter(Boolean);

/** Premiers mots (sans accents ni ponctuation, comme `descriptionHead`) et leur catégorie. */
const HEADS: Record<Exclude<ArticleCategory, "autre">, string[]> = {
  personne: words(`
    acteur actrice chanteur chanteuse musicien musicienne rappeur rappeuse ecrivain ecrivaine auteur autrice
    poete poetesse peintre sculpteur sculptrice dessinateur dessinatrice illustrateur illustratrice photographe
    realisateur realisatrice producteur productrice scenariste compositeur compositrice chef comedien comedienne
    humoriste animateur animatrice presentateur presentatrice journaliste mannequin styliste architecte
    footballeur footballeuse joueur joueuse athlete nageur nageuse cycliste coureur coureuse boxeur boxeuse
    basketteur basketteuse handballeur handballeuse rugbyman tennisman tenniswoman skieur skieuse pilote patineur
    patineuse judoka lutteur catcheur catcheuse gymnaste escrimeur entraineur entraineuse arbitre sportif sportive
    homme femme personnalite personnage roi reine empereur imperatrice pape prince princesse duc duchesse comte
    comtesse saint sainte pharaon sultan tsar tsarine noble aristocrate dirigeant dirigeante president presidente
    militaire general officier marechal amiral soldat resistant resistante aviateur aviatrice astronaute
    cosmonaute explorateur exploratrice navigateur navigatrice inventeur inventrice ingenieur ingenieure
    entrepreneur entrepreneuse industriel industrielle banquier banquiere philosophe theologien theologienne
    scientifique physicien physicienne chimiste mathematicien mathematicienne astronome biologiste medecin
    psychologue psychanalyste historien historienne sociologue economiste juriste avocat avocate magistrat
    diplomate politologue linguiste archeologue geographe anthropologue professeur professeure enseignant
    youtubeur youtubeuse videaste streamer streameuse influenceur influenceuse blogueur blogueuse criminel
    criminelle tueur tueuse gangster terroriste espion espionne survivant survivante victime miss divinite
    dieu deesse heros heroine mutant vampire sorcier sorciere superheros superheroine danseur danseuse
    chorégraphe choregraphe pianiste guitariste batteur violoniste violoncelliste bassiste dj disc
    cuisinier cuisiniere moine religieux religieuse eveque cardinal pretre rabbin imam missionnaire martyr
  `),
  lieu: words(`
    commune ville village capitale metropole agglomeration localite municipalite bourg hameau quartier
    arrondissement canton departement region province comte etat pays territoire principaute royaume
    emirat republique colonie oblast district voivodie land prefecture collectivite ile archipel atoll
    presquile peninsule continent fleuve riviere lac mer ocean baie golfe detroit cap plage lagune
    montagne mont massif sommet volcan colline vallee plateau plaine desert foret parc jardin reserve
    chateau palais cathedrale eglise basilique abbaye monastere mosquee temple synagogue chapelle monument
    pont tour gratteciel immeuble batiment edifice stade arene aeroport gare port phare barrage canal rue
    avenue boulevard place autoroute route tunnel musee site cimetiere grotte glacier cascade chutes source
    oasis ville-etat
  `),
  oeuvre: words(`
    film telefilm serie feuilleton emission jeu album chanson single morceau roman livre nouvelle recueil
    manga anime comics webtoon opera operette ballet symphonie concerto tableau peinture fresque statue poeme
    piece oeuvre saga trilogie tetralogie courtmetrage longmetrage documentaire webserie episode spectacle
    comedie drame tragedie conte essai bande dessin franchise ep mixtape compilation clip hymne
    sitcom telenovela podcast
  `),
  organisation: words(`
    entreprise societe groupe club equipe parti organisation association federation ligue syndicat constructeur
    fabricant marque label studio compagnie banque universite ecole lycee college institut institution agence
    journal quotidien hebdomadaire mensuel magazine revue radio chaine conglomerat multinationale firme
    armee gouvernement ministere parlement assemblee senat conseil commission tribunal cour fondation ong
    collectif mouvement ordre alliance coalition confederation union organisme service plateforme reseau
    editeur distributeur operateur selection
  `),
};

/** Débuts en deux mots qui changent la catégorie du premier mot seul. */
const PAIRS: [RegExp, ArticleCategory][] = [
  [/^chaine (de|des) (montagnes?|volcans?|iles?)\b/, "lieu"],
  [/^chaine de (restaurants?|restauration|magasins?|supermarches?|hotels?)\b/, "organisation"],
  [/^station de (radio|television)\b/, "organisation"],
  [/^station\b/, "lieu"],
  [/^piece de (theatre|musique)\b/, "oeuvre"],
  [/^piece (de|d) (monnaie|artillerie|echecs)\b/, "autre"],
  [/^bande dessinee\b/, "oeuvre"],
  [/^bande (de|d) /, "lieu"],
  [/^dessin anime\b/, "oeuvre"],
  [/^jeux? (olympiques?|paralympiques?)\b/, "autre"],
  [/^jeu de (cartes|des|role|plateau|societe)\b/, "oeuvre"],
  [/^site (web|internet)\b/, "autre"],
  [/^navigateur (web|internet)\b/, "autre"],
  [/^ordre (de|d|des) [a-z]+ (de l|du|des)? ?(regne|classe|insectes|mammiferes|oiseaux|plantes)/, "autre"],
  [/^franchise (de|d) (basket|hockey|football|baseball|sport)/, "organisation"],
  [/^groupe (de|d) (rock|musique|pop|metal|rap|hip|jazz|punk|chanteurs|musiciens)/, "organisation"],
  [/^groupe ethnique\b/, "autre"],
  [/^service (de|d) (streaming|videos?|messagerie|renseignement|police)/, "organisation"],
  [/^parc (national|naturel|d attractions|a theme|zoologique)\b/, "lieu"],
  [/^reseau social\b/, "autre"],
  [/^personnage\b/, "personne"],
];

/** Fins de mot qui désignent presque toujours une personne (« -iste », « -ienne », « -trice »). */
const PERSON_SUFFIX = /^[a-z]{4,}(iste|ien|ienne|trice|euse)$/;
const NOT_PERSON = new Set(["liste", "piste", "chien", "chienne", "ancien", "ancienne", "matrice", "tondeuse"]);

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`-]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const HEAD_INDEX = new Map<string, ArticleCategory>(
  (Object.entries(HEADS) as [ArticleCategory, string[]][]).flatMap(([cat, list]) =>
    list.map((w) => [plain(w).replace(/ /g, ""), cat] as [string, ArticleCategory]),
  ),
);

/**
 * Catégorie d'un article d'après sa description courte. Sans description, ou mot inconnu : « autre ».
 * `human` (Wikidata : nature « être humain ») force « personne » quand on le sait.
 */
export function articleCategory(
  description: string | null | undefined,
  hints: { human?: boolean } = {},
): ArticleCategory {
  if (hints.human) return "personne";
  const raw = (description ?? "")
    .trim()
    .replace(/^(un|une|le|la|les)\s+/i, "")
    .replace(/^l['’]/i, "");
  const text = plain(raw);
  if (!text) return "autre";
  for (const [re, cat] of PAIRS) if (re.test(text)) return cat;
  const head = descriptionHead(raw);
  if (!head) return "autre";
  const known = HEAD_INDEX.get(head);
  if (known) return known;
  if (PERSON_SUFFIX.test(head) && !NOT_PERSON.has(head)) return "personne";
  return "autre";
}

/** Premier mot de la description, tel qu'écrit (attribut « Type » de l'article du jour). */
export function descriptionType(description: string | null | undefined): string | null {
  const first = description
    ?.trim()
    .split(/\s+/)[0]
    ?.replace(/[,.;:!?()«»"]+$/g, "")
    .toLowerCase();
  return first || null;
}

/** Racine d'un type, au masculin (« actrice » → « acteur », « chanteuse » → « chanteur ») : types proches. */
export function typeStem(type: string): string {
  const t = plain(type).replace(/ /g, "");
  return t
    .replace(/rice$/, "eur")
    .replace(/euse$/, "eur")
    .replace(/ienne$/, "ien")
    .replace(/ere$/, "er")
    .replace(/ive$/, "if")
    .replace(/e$/, "")
    .replace(/s$/, "");
}
