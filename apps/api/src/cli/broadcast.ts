/**
 * Message serveur depuis l'infra (même effet que « Envoyer » dans la page Admin) :
 *   dev  : pnpm --filter @palacards/api broadcast:send --title "Mise à jour" --body "Les quêtes sont là !"
 *   prod : docker compose exec api node dist/cli/broadcast.js send --title … --body … [--tone update]
 *          [--link /quests --link-label "Voir les quêtes"] [--expires 2026-12-01]
 * Le message part aussitôt aux joueurs connectés (l'API écoute `pg_notify`) et attend les autres
 * à leur prochaine visite. `list` affiche les derniers messages.
 */
import { createDb, schema, sql } from "@palacards/db";
import { desc } from "@palacards/db";
import { parseArgs } from "node:util";
import { BROADCAST_CHANNEL } from "../services/broadcasts.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant.");
  process.exit(2);
}
const [command, ...rest] = process.argv.slice(2);
const { db, client } = createDb(url, { max: 1 });
try {
  if (command === "send") {
    const { values } = parseArgs({
      args: rest,
      options: {
        title: { type: "string" },
        body: { type: "string" },
        tone: { type: "string", default: "info" },
        link: { type: "string" },
        "link-label": { type: "string" },
        expires: { type: "string" },
      },
    });
    const tone = values.tone as "info" | "update" | "event" | "warning";
    if (!values.title?.trim() || !values.body?.trim()) throw new Error("--title et --body sont obligatoires.");
    if (!["info", "update", "event", "warning"].includes(tone))
      throw new Error("--tone : info, update, event ou warning.");
    const [row] = await db
      .insert(schema.broadcasts)
      .values({
        title: values.title.trim().slice(0, 80),
        body: values.body.trim().slice(0, 2_000),
        tone,
        linkUrl: values.link ?? null,
        linkLabel: values["link-label"] ?? null,
        expiresAt: values.expires ? new Date(values.expires) : null,
        createdBy: "cli",
        status: "sent",
        sentAt: new Date(),
      })
      .returning({ id: schema.broadcasts.id });
    await db.execute(sql`select pg_notify(${BROADCAST_CHANNEL}, ${String(row!.id)})`);
    console.log(`Message ${row!.id} envoyé.`);
  } else if (command === "list") {
    const rows = await db.select().from(schema.broadcasts).orderBy(desc(schema.broadcasts.id)).limit(20);
    for (const r of rows) console.log(`${r.id}\t${r.status}\t${r.sentAt?.toISOString() ?? "-"}\t${r.title}`);
  } else {
    console.error("Usage : broadcast.js send --title … --body … [--tone info|update|event|warning] [--link …] | list");
    process.exitCode = 2;
  }
} catch (err) {
  console.error("Échec :", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
