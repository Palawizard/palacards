import type { Db } from "@palacards/db";
import type { RandomInt } from "@palacards/game";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import { randomInt } from "node:crypto";
import { ensurePlayer, getSessionUser, type Auth, type SessionUser } from "./auth.js";
import type { Config } from "./config.js";
import { GameError } from "./errors.js";
import type { Jobs } from "./jobs.js";
import type { Realtime } from "./realtime.js";
import type { Wiki } from "./services/wiki.js";

/** Dépendances partagées par les services. `now` et `random` sont injectables pour les tests. */
export interface Ctx {
  db: Db;
  config: Config;
  auth: Auth;
  rt: Realtime;
  log: FastifyBaseLogger;
  wiki: Wiki;
  jobs: Jobs;
  now: () => Date;
  random: RandomInt;
}

export const secureRandom: RandomInt = (max) => randomInt(max);

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser;
  }
}

const knownPlayers = new Set<string>();

export function requireUser(ctx: Pick<Ctx, "auth" | "config" | "db">) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const user = await getSessionUser(ctx.auth, ctx.config, req.headers);
    if (!user) throw new GameError(401, "unauthorized", "Connecte-toi pour continuer.");
    if (!knownPlayers.has(user.id)) {
      await ensurePlayer(ctx.db, user.id);
      knownPlayers.add(user.id);
    }
    req.user = user;
  };
}

export function requireAdmin(ctx: Pick<Ctx, "auth" | "config" | "db">) {
  const base = requireUser(ctx);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await base(req, reply);
    if (!req.user.isAdmin) throw new GameError(403, "forbidden", "Réservé aux admins.");
  };
}
