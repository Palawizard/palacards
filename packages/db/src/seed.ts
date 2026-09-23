import { existsSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import postgres from "postgres";

// `pnpm db:seed` : charge un échantillon de vraies cartes (≈ 20 000) dans la base de dev,
// pour jouer sans l'import complet. L'échantillon est produit par :
//   cd tools/import && palacards-import all --limit 20000
// S'il est absent, on génère des cartes synthétiques (titres factices) pour que le jeu reste jouable.

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant : copie .env.example en .env à la racine du repo.");
  process.exit(1);
}

const SEASON = 1;
const SYNTHETIC_COUNT = 20_000;
const sampleFile = fileURLToPath(new URL("../../../tools/import/data/out/cards-sample.csv.gz", import.meta.url));
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const [existing] = await sql<{ n: number }[]>`select count(*)::int as n from cards where season = ${SEASON}`;
  if (existing && existing.n > 0) {
    console.log(`La saison ${SEASON} a déjà ${existing.n} cartes : rien à faire.`);
  } else {
    const counts = await sql.begin(async (tx) => {
      await tx`truncate cards_next`;
      if (existsSync(sampleFile)) {
        console.log(`Chargement de ${sampleFile}…`);
        const writable = await tx`
          copy cards_next (id, title, rarity, atk, def, views_12m, page_len) from stdin with (format csv, header true)
        `.writable();
        await pipeline(createReadStream(sampleFile), createGunzip(), writable);
      } else {
        console.warn("Échantillon réel absent : génération de cartes synthétiques (voir tools/import).");
        await tx`
          insert into cards_next (id, title, rarity, atk, def, views_12m, page_len)
          select gs, 'Carte synthétique n° ' || gs,
                 (case when gs <= greatest(1, floor(1000 * ${SYNTHETIC_COUNT}::numeric / 2700000 + 0.5)) then 'L'
                       when gs <= floor(10000 * ${SYNTHETIC_COUNT}::numeric / 2700000 + 0.5) then 'UR'
                       when gs <= floor(50000 * ${SYNTHETIC_COUNT}::numeric / 2700000 + 0.5) then 'SR'
                       when gs <= floor(250000 * ${SYNTHETIC_COUNT}::numeric / 2700000 + 0.5) then 'R'
                       when gs <= floor(1000000 * ${SYNTHETIC_COUNT}::numeric / 2700000 + 0.5) then 'PC'
                       else 'C' end)::rarity,
                 100 + floor(random() * 9899), 100 + floor(random() * 9899),
                 ${SYNTHETIC_COUNT} - gs, 1000 + floor(random() * 100000)
          from generate_series(1, ${SYNTHETIC_COUNT}) gs
        `;
      }
      return tx<{ rarity: string; cards: string }[]>`select * from finish_card_load(${SEASON})`;
    });
    await sql`analyze cards`;
    console.log(`Saison ${SEASON} chargée :`, counts.map((c) => `${c.rarity} ${c.cards}`).join(", "));
  }
} catch (err) {
  console.error("Échec du seed :", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
