import { DECK_SIZE } from "@palacards/game";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import {
  acceptChallenge,
  answerQuestion,
  battleDetail,
  battleRoom,
  challenge,
  isParticipant,
  listBattles,
  liveBattles,
  refuseChallenge,
  serveQuestion,
} from "../services/battles.js";

const id = z.coerce.number().int().positive();
const deck = z.array(z.number().int().positive()).length(DECK_SIZE);

export function battleRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };
  const limited = (max: number) => ({ ...auth, config: { rateLimit: { max, timeWindow: "1 minute" } } });

  api.get("/battles", auth, async (req) => listBattles(ctx, req.user.id));
  api.get("/battles/:id", auth, async (req) => battleDetail(ctx, req.user.id, parse(z.object({ id }), req.params).id));
  api.post("/battles", limited(10), async (req) => {
    const body = parse(z.object({ opponent: z.string().trim().min(1).max(30), mode: z.enum(["live", "async"]), deck }), req.body);
    return challenge(ctx, req.user.id, body);
  });
  api.post("/battles/:id/accept", limited(10), async (req) => {
    const { deck: d } = parse(z.object({ deck }), req.body);
    return acceptChallenge(ctx, req.user.id, parse(z.object({ id }), req.params).id, d);
  });
  api.post("/battles/:id/refuse", auth, async (req) => {
    await refuseChallenge(ctx, req.user.id, parse(z.object({ id }), req.params).id);
    return { ok: true };
  });
  /** Sert la question d'une manche et démarre le chrono (serveur). */
  api.post("/battles/:id/rounds/:round/question", limited(60), async (req) => {
    const p = parse(z.object({ id, round: z.coerce.number().int().min(1).max(5) }), req.params);
    return serveQuestion(ctx, req.user.id, p.id, p.round);
  });
  api.post("/battles/:id/rounds/:round/answer", limited(60), async (req) => {
    const p = parse(z.object({ id, round: z.coerce.number().int().min(1).max(5) }), req.params);
    const { choice } = parse(z.object({ choice: z.number().int().min(-1).max(3) }), req.body);
    return answerQuestion(ctx, req.user.id, p.id, p.round, choice);
  });

  // Salle par duel : le client la rejoint en ouvrant l'écran du duel (reconnexion comprise).
  ctx.rt.onConnection((socket) => {
    socket.on("battle:join", (raw) => {
      const r = id.safeParse(raw);
      if (!r.success) return;
      const userId = socket.data.userId;
      void isParticipant(ctx, userId, r.data)
        .then((ok) => {
          if (!ok) return;
          void socket.join(battleRoom(r.data));
          liveBattles.join(ctx, userId, r.data);
        })
        .catch(() => {});
    });
  });
}
