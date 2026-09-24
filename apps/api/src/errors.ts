import type { FastifyError, FastifyInstance } from "fastify";
import { z } from "zod";

// Messages de validation en français (affichés tels quels par le front).
z.config(z.locales.fr());

/** Erreur métier : code stable pour le front, message en français affichable tel quel. */
export class GameError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new GameError(400, code, message);
export const notFound = (message = "Introuvable") => new GameError(404, "not_found", message);
export const conflict = (code: string, message: string) => new GameError(409, code, message);
export const forbidden = (message = "Action interdite") => new GameError(403, "forbidden", message);

/** Valide une entrée avec Zod ; erreur 400 lisible sinon. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const res = schema.safeParse(data);
  if (!res.success) {
    const first = res.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")} : ` : "";
    throw new GameError(400, "invalid_input", `${where}${first?.message ?? "entrée invalide"}`);
  }
  return res.data;
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | GameError, req, reply) => {
    if (err instanceof GameError) {
      return reply.status(err.status).send({ error: err.code, message: err.message });
    }
    if (err.statusCode === 429) {
      return reply.status(429).send({ error: "rate_limited", message: "Trop de requêtes, réessaie dans un instant." });
    }
    if (err.statusCode && err.statusCode < 500) {
      // Erreurs de Fastify (JSON invalide, corps trop gros…) : message anglais remplacé par un message français.
      const message = err.statusCode === 413 ? "Requête trop volumineuse." : err.statusCode === 404 ? "Introuvable." : "Requête invalide.";
      return reply.status(err.statusCode).send({ error: err.code ?? "bad_request", message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal", message: "Erreur du serveur, réessaie plus tard." });
  });
}
