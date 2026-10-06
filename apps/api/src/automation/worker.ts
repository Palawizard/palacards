/**
 * Service de tri des suggestions (conteneur `triage`, profil Docker « automation ») :
 *   node dist/automation/worker.js
 * Réveillé par NOTIFY à chaque nouvelle suggestion, et toutes les minutes pour les reprises et le plafond du jour.
 */
import { createDb } from "@palacards/db";
import { z } from "zod";
import { AUTOMATION_CHANNEL } from "../services/automation.js";
import { createEngine } from "./engine.js";
import { runClaudeCli } from "./triage.js";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    CLAUDE_CODE_OAUTH_TOKEN: z.string().min(20, "CLAUDE_CODE_OAUTH_TOKEN manquant (claude setup-token)"),
    TRIAGE_MODEL: z.string().default("sonnet"),
    GITHUB_REPOSITORY: z.string().default("Palawizard/palacards"),
    /** Jeton GitHub limité aux issues du dépôt (fine-grained, Issues : lecture et écriture). */
    GITHUB_ISSUES_TOKEN: z.string().min(1).optional(),
    DISCORD_WEBHOOK_URL: z.url().optional(),
    AUTOMATION_MAX_BUILDS_PER_DAY: z.coerce.number().int().min(0).max(50).default(15),
    WEB_ORIGIN: z.string().default("https://palawi.fr"),
    BASE_PATH: z.string().default("/palacards"),
  })
  .parse(process.env);

const log = {
  info: (o: object, m?: string) => console.log(JSON.stringify({ level: "info", time: Date.now(), msg: m, ...o })),
  error: (o: object, m?: string) => {
    const { err, ...rest } = o as { err?: unknown };
    console.error(
      JSON.stringify({
        level: "error",
        time: Date.now(),
        msg: m,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        ...rest,
      }),
    );
  },
};

const { db, client } = createDb(env.DATABASE_URL, { max: 3 });
const engine = createEngine({
  db,
  now: () => new Date(),
  log,
  runner: runClaudeCli,
  model: env.TRIAGE_MODEL,
  github: env.GITHUB_ISSUES_TOKEN ? { repository: env.GITHUB_REPOSITORY, token: env.GITHUB_ISSUES_TOKEN } : null,
  discordUrl: env.DISCORD_WEBHOOK_URL,
  maxBuildsPerDay: env.AUTOMATION_MAX_BUILDS_PER_DAY,
  publicUrl: `${env.WEB_ORIGIN}${env.BASE_PATH}`,
});

if (!env.GITHUB_ISSUES_TOKEN) log.info({}, "GITHUB_ISSUES_TOKEN absent : les suggestions à coder restent en file");

await engine.releaseStale();
await client.listen(AUTOMATION_CHANNEL, () => void engine.tick());
const timer = setInterval(() => void engine.tick(), 60_000);
log.info({ model: env.TRIAGE_MODEL, maxBuildsPerDay: env.AUTOMATION_MAX_BUILDS_PER_DAY }, "service de tri démarré");
void engine.tick();

async function stop() {
  clearInterval(timer);
  await client.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
