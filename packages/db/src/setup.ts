import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

type Sql = postgres.Sql | postgres.TransactionSql;

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Applique les migrations Drizzle sur `url`. */
export async function migrateDatabase(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** (Re)crée une base vide sur le même serveur que `adminUrl` et renvoie son URL. */
export async function recreateDatabase(adminUrl: string, name: string): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`nom de base invalide : ${name}`);
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

// Vocabulaire des titres « variés » (benchmark) : des titres qui se ressemblent tous
// (« Carte synthétique n° N ») sont le pire cas d'un index trigram et ne ressemblent pas à Wikipédia.
const WORDS = (
  "château église rivière montagne histoire bataille royaume république musée gare pont forêt île lac vallée " +
  "abbaye cathédrale village commune canton province région département comté duché empire dynastie famille " +
  "guerre traité révolution siège campagne armée régiment flotte navire sous-marin avion locomotive tramway " +
  "autoroute route rue place avenue boulevard quartier faubourg port phare canal barrage centrale usine mine " +
  "école lycée université collège académie bibliothèque théâtre opéra cinéma festival concert album chanson " +
  "groupe orchestre symphonie sonate roman poème nouvelle pièce film série saison épisode personnage héros " +
  "roi reine prince princesse comte duc évêque pape saint martyr moine chevalier ordre croisade concile " +
  "football rugby tennis cyclisme athlétisme natation championnat coupe tournoi stade équipe club joueur " +
  "espèce genre famille insecte oiseau mammifère poisson reptile plante arbre fleur champignon bactérie virus " +
  "étoile planète galaxie comète astéroïde satellite constellation nébuleuse cratère volcan glacier désert " +
  "langue dialecte alphabet écriture philosophie théorie théorème équation fonction nombre algèbre géométrie " +
  "élection parti gouvernement ministère assemblée sénat constitution loi décret code tribunal procès affaire " +
  "rouge bleu vert noir blanc grand petit nouveau vieux haut bas saint-pierre saint-martin sainte-marie " +
  "nord sud est ouest central royal impérial national international municipal français européen africain " +
  "paris lyon marseille toulouse bordeaux lille nantes strasbourg rennes grenoble dijon angers nîmes brest " +
  "france belgique suisse québec espagne italie allemagne angleterre écosse irlande portugal grèce égypte japon"
).split(" ");

/**
 * Remplit `cards_next` de `count` cartes synthétiques dont les paliers suivent les proportions
 * du pool complet (plafonds de rang × count / 2,7 M), prêtes pour `finish_card_load`.
 * `variedTitles` : titres de 2 à 4 mots tirés d'un vocabulaire (benchmark de la recherche) ;
 * sinon « Carte synthétique n° N » (tests et E2E, qui cherchent ces titres).
 */
export async function fillSyntheticCards(
  sql: Sql,
  count: number,
  options: { variedTitles?: boolean } = {},
): Promise<void> {
  const tiers = (ceil: number) =>
    count >= 2_000_000 ? ceil : Math.max(1, Math.floor((ceil * count) / 2_700_000 + 0.5));
  const [l, ur, sr, r, pc] = [1_000, 10_000, 50_000, 250_000, 1_000_000].map(tiers) as [
    number,
    number,
    number,
    number,
    number,
  ];
  await sql`
    insert into cards_next (id, title, rarity, atk, def, views_12m, page_len)
    select gs,
           ${
             options.variedTitles
               ? sql`initcap(w[1 + (gs::bigint * 7919) % ${WORDS.length}]) || ' ' || w[1 + (gs::bigint * 104729 / 7) % ${WORDS.length}]
                     || (case when gs % 3 = 0 then ' de ' || initcap(w[1 + (gs::bigint * 1299709 / 13) % ${WORDS.length}]) else '' end)
                     || (case when gs % 5 = 0 then ' (' || (1800 + gs % 225) || ')' else '' end) || ' ' || gs`
               : sql`'Carte synthétique n° ' || gs`
           },
           (case when gs <= ${l} then 'L' when gs <= ${ur} then 'UR' when gs <= ${sr} then 'SR'
                 when gs <= ${r} then 'R' when gs <= ${pc} then 'PC' else 'C' end)::rarity,
           100 + floor(random() * 9899), 100 + floor(random() * 9899),
           ${count} - gs, 1000 + floor(random() * 100000)
    from generate_series(1, ${count}) gs, (select ${WORDS}::text[] as w) v
  `;
}

/** Active une saison si aucune ne l'est (fin : 1er du mois prochain, heure de Paris). */
export async function ensureActiveSeason(sql: Sql, season: number): Promise<void> {
  await sql`
    insert into seasons (id, status, started_at, ends_at)
    select ${season}, 'active', now(),
           (date_trunc('month', now() at time zone 'Europe/Paris') + interval '1 month') at time zone 'Europe/Paris'
    where not exists (select 1 from seasons where status = 'active')
    on conflict (id) do nothing
  `;
}
