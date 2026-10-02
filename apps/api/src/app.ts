import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createDb } from "@palacards/db";
import { MAX_STORED_PACKS, PACK_REGEN_MS } from "@palacards/game";
import { fromNodeHeaders } from "better-auth/node";
import Fastify, { type FastifyRequest } from "fastify";
import { createAuth, SESSION_COOKIE, SSO_PROVIDER_ID, type Auth } from "./auth.js";
import { ssoConfig, type Config } from "./config.js";
import { secureRandom, sessionUser, type Ctx } from "./context.js";
import { registerErrorHandler } from "./errors.js";
import { createJobs } from "./jobs.js";
import { createRealtime } from "./realtime.js";
import { coreRoutes } from "./routes/core.js";
import { economyRoutes } from "./routes/economy.js";
import { socialRoutes } from "./routes/social.js";
import { battleRoutes } from "./routes/battles.js";
import { progressionRoutes } from "./routes/progression.js";
import { privacyRoutes } from "./routes/privacy.js";
import { contentRoutes } from "./routes/content.js";
import { prepareAccountDeletion } from "./services/privacy.js";
import { BROADCAST_CHANNEL, pushBroadcast } from "./services/broadcasts.js";
import { progressionIdle, registerProgressionHooks } from "./services/progression.js";
import { wirePresence } from "./services/social.js";
import { registerJobs } from "./services/jobs-handlers.js";
import { battleEngine, resumeBattles } from "./services/battles.js";
import { testRoutes } from "./routes/test.js";
import { createWiki } from "./services/wiki.js";

export interface BuildOptions {
  /** Démarre pg-boss (désactivé dans les tests d'intégration). */
  jobs?: boolean;
  now?: () => Date;
}

/**
 * Clé de limitation de débit : l'utilisateur de la session validée (un cookie inventé ne donne pas
 * un nouveau compteur), sinon l'IP réelle. `cf-connecting-ip` n'est lu que derrière le proxy (TRUST_PROXY),
 * sinon n'importe quel client pourrait le falsifier ; `req.ip` suit déjà `trustProxy`.
 */
export async function rateLimitKey(
  config: Pick<Config, "TRUST_PROXY">,
  auth: Auth | undefined,
  req: FastifyRequest,
): Promise<string> {
  if (auth && req.headers.cookie?.includes(`${SESSION_COOKIE}=`)) {
    try {
      const user = await sessionUser(auth, req);
      if (user) return `user:${user.id}`;
    } catch {
      // session illisible (base indisponible…) : repli sur l'IP
    }
  }
  const cf = req.headers["cf-connecting-ip"];
  if (config.TRUST_PROXY && typeof cf === "string" && cf) return `ip:${cf}`;
  return `ip:${req.ip}`;
}

export async function buildApp(config: Config, options: BuildOptions = {}) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 256 * 1024,
  });
  registerErrorHandler(app);
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  const apiPrefix = `${config.BASE_PATH}/api`;
  const database = config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined;
  // Le temps réel a besoin de l'auth (handshake) et l'auth coupe les sockets à la révocation d'une session.
  const late: { rt?: { disconnectUser(userId: string): void }; ctx?: Ctx } = {};
  const auth = database
    ? createAuth(database.db, config, {
        onSessionsRevoked: (userId) => late.rt?.disconnectUser(userId),
        beforeDeleteUser: async (userId) => {
          if (late.ctx) await prepareAccountDeletion(late.ctx, userId);
        },
      })
    : undefined;

  await app.register(rateLimit, {
    // Plafond global (lectures comprises : catalogue, fiches, résumés Wikipédia) ; routes sensibles plus strictes.
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => rateLimitKey(config, auth, req),
  });
  const rt = createRealtime(app.server, config, auth, app.log);
  late.rt = rt;
  const jobs = createJobs(options.jobs ? config.DATABASE_URL : undefined, app.log);

  let ctx: Ctx | undefined;
  if (database && auth) {
    ctx = {
      db: database.db,
      config,
      auth,
      rt,
      log: app.log,
      wiki: createWiki(database.db, config, app.log),
      jobs,
      now: options.now ?? (() => new Date()),
      random: secureRandom,
    };
    late.ctx = ctx;
    registerJobs(ctx);
    wirePresence(ctx);
    registerProgressionHooks();
  }

  await app.register(
    async (api) => {
      api.get("/health", async () => {
        let db: "up" | "down" | "not_configured" = "not_configured";
        if (database) {
          try {
            await database.client`select 1`;
            db = "up";
          } catch {
            db = "down";
          }
        }
        return { status: "ok", database: db, time: new Date().toISOString() };
      });

      api.get("/config", async () => {
        const sso = ssoConfig(config);
        return {
          maxStoredPacks: MAX_STORED_PACKS,
          packRegenMs: PACK_REGEN_MS,
          // Le web choisit entre le bouton Authentik et le formulaire pseudo + mot de passe.
          auth: sso
            ? {
                mode: "sso" as const,
                provider: SSO_PROVIDER_ID,
                accountUrl: sso.accountUrl,
                deleteAccountUrl: sso.deleteAccountUrl,
                ...(sso.signupUrl ? { signupUrl: sso.signupUrl } : {}),
              }
            : { mode: "password" as const },
        };
      });

      if (!ctx || !auth) return;

      // Better Auth : Fastify a déjà lu le corps, on reconstruit une Request Web.
      api.route({
        method: ["GET", "POST"],
        url: "/auth/*",
        async handler(request, reply) {
          const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
          const res = await auth.handler(
            new Request(url, {
              method: request.method,
              headers: fromNodeHeaders(request.headers),
              ...(request.body ? { body: JSON.stringify(request.body) } : {}),
            }),
          );
          reply.status(res.status);
          res.headers.forEach((value, key) => {
            if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
          });
          const cookies = res.headers.getSetCookie();
          if (cookies.length) reply.header("set-cookie", cookies);
          return reply.send(res.body ? await res.text() : null);
        },
      });

      coreRoutes(api, ctx);
      economyRoutes(api, ctx);
      socialRoutes(api, ctx);
      battleRoutes(api, ctx);
      progressionRoutes(api, ctx);
      privacyRoutes(api, ctx);
      contentRoutes(api, ctx);
      if (config.GAME_TEST_MODE) testRoutes(api, ctx);
    },
    { prefix: apiPrefix },
  );

  app.addHook("onReady", async () => {
    await jobs.start();
    // Duels en cours au redémarrage : les échéances sont reprogrammées depuis la base.
    if (ctx) await resumeBattles(ctx);
    // Messages serveur envoyés par la CLI (autre processus) : poussés aux joueurs connectés.
    if (ctx && database && options.jobs) {
      const live = ctx;
      await database.client.listen(BROADCAST_CHANNEL, (id) => {
        void pushBroadcast(live, Number(id)).catch((err) => app.log.error({ err }, "message serveur"));
      });
    }
  });
  app.addHook("onClose", async () => {
    await battleEngine.stopAll();
    await jobs.stop();
    await progressionIdle();
    rt.io.close();
    await database?.client.end({ timeout: 5 });
  });

  return { app, io: rt.io, ctx };
}
