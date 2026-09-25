import type { FastifyBaseLogger } from "fastify";
import { PgBoss, type Job, type QueueOptions } from "pg-boss";

type Handler = (data: Record<string, unknown>) => Promise<void>;

/**
 * File de jobs pg-boss (dans Postgres, schéma `pgboss`) : clôture des enchères, expirations,
 * fin de saison, objectifs de guilde. Les handlers sont idempotents : un job en retard ou
 * rejoué ne fait rien si l'état en base a changé.
 */
export function createJobs(databaseUrl: string | undefined, log: FastifyBaseLogger) {
  const boss = databaseUrl ? new PgBoss({ connectionString: databaseUrl, schema: "pgboss" }) : null;
  const handlers = new Map<string, Handler>();
  const queueOptions = new Map<string, QueueOptions>();
  const schedules: { name: string; cron: string }[] = [];
  let started = false;

  boss?.on("error", (err) => log.error({ err }, "pg-boss"));

  return {
    /** Déclare une file et son handler (avant `start`). */
    define(name: string, handler: Handler, options?: QueueOptions) {
      handlers.set(name, handler);
      if (options) queueOptions.set(name, options);
    },
    /** Exécution récurrente (cron, heure de Paris). */
    schedule(name: string, cron: string, handler: Handler) {
      handlers.set(name, handler);
      schedules.push({ name, cron });
    },
    async start() {
      if (!boss || started) return;
      await boss.start();
      for (const [name, handler] of handlers) {
        await boss.createQueue(name, { retryLimit: 5, retryDelay: 5, retryBackoff: true, ...queueOptions.get(name) });
        await boss.work<Record<string, unknown>>(name, async (jobs: Job<Record<string, unknown>>[]) => {
          for (const job of jobs) await handler(job.data ?? {});
        });
      }
      for (const { name, cron } of schedules) await boss.schedule(name, cron, null, { tz: "Europe/Paris" });
      started = true;
    },
    /** Programme un job à une date donnée. Sans pg-boss (tests), ne fait rien. */
    async sendAt(name: string, data: Record<string, unknown>, at: Date) {
      if (!boss || !started) return;
      await boss.send(name, data, { startAfter: at });
    },
    /** Lance un handler tout de suite, sans passer par la file (tests, admin). */
    async runNow(name: string, data: Record<string, unknown> = {}) {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`job inconnu : ${name}`);
      await handler(data);
    },
    async status() {
      if (!boss || !started) return [];
      const out = [];
      for (const name of handlers.keys()) {
        const q = await boss.getQueue(name);
        out.push({ name, queued: q?.queuedCount ?? 0, active: q?.activeCount ?? 0, total: q?.totalCount ?? 0 });
      }
      return out;
    },
    async stop() {
      if (boss && started) await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}

export type Jobs = ReturnType<typeof createJobs>;
