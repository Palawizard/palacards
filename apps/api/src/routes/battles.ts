import { DECK_SIZE, SAVED_DECK_NAME_MAX } from "@palacards/game";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import {
  acceptChallenge,
  answerQuestion,
  battleEngine,
  battleState,
  challenge,
  chooseAttack,
  chooseShield,
  forfeit,
  isParticipant,
  joinQueue,
  leaveQueue,
  listBattles,
  queueState,
  refuseChallenge,
  serialAction,
  wireQueuePresence,
} from "../services/battles.js";
import { createSavedDeck, deleteSavedDeck, listSavedDecks, updateSavedDeck } from "../services/saved-decks.js";

const id = z.coerce.number().int().positive();
const deck = z.array(z.number().int().positive()).length(DECK_SIZE);
const slot = z.number().int().min(1).max(DECK_SIZE);
/** Deck enregistré : nom (nettoyé par le service) et 0 à 5 exemplaires. */
const deckName = z.string().max(SAVED_DECK_NAME_MAX * 2);
const deckCards = z.array(z.number().int().positive()).max(DECK_SIZE);

export function battleRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };
  const limited = (max: number) => ({ ...auth, config: { rateLimit: { max, timeWindow: "1 minute" } } });
  const battleId = (params: unknown) => parse(z.object({ id }), params).id;

  api.get("/battles", auth, async (req) => listBattles(ctx, req.user.id));
  api.get("/battles/:id", auth, async (req) => battleState(ctx, req.user.id, battleId(req.params)));
  api.post("/battles", limited(10), async (req) => {
    const body = parse(z.object({ opponent: z.string().trim().min(1).max(30), deck }), req.body);
    return challenge(ctx, req.user.id, body);
  });
  // Decks enregistrés (privés) : le joueur en choisit un au lieu de recomposer sa sélection.
  api.get("/battles/decks", auth, async (req) => listSavedDecks(ctx, req.user.id));
  api.post("/battles/decks", limited(30), async (req) => {
    const body = parse(z.object({ name: deckName, cards: deckCards }), req.body);
    return createSavedDeck(ctx, req.user.id, body);
  });
  api.put("/battles/decks/:id", limited(30), async (req) => {
    const body = parse(z.object({ name: deckName.optional(), cards: deckCards.optional() }), req.body);
    return updateSavedDeck(ctx, req.user.id, battleId(req.params), body);
  });
  api.delete("/battles/decks/:id", limited(30), async (req) => {
    await deleteSavedDeck(ctx, req.user.id, battleId(req.params));
    return { ok: true };
  });
  // File de matchmaking : le duel démarre dès que deux joueurs connectés y sont.
  api.get("/battles/queue", auth, async (req) => queueState(ctx, req.user.id));
  api.post("/battles/queue", limited(10), async (req) => {
    const { deck: d } = parse(z.object({ deck }), req.body);
    return joinQueue(ctx, req.user.id, d);
  });
  api.post("/battles/queue/leave", auth, async (req) => {
    await leaveQueue(ctx, req.user.id);
    return { ok: true };
  });
  api.post("/battles/:id/accept", limited(10), async (req) => {
    const { deck: d } = parse(z.object({ deck }), req.body);
    return acceptChallenge(ctx, req.user.id, battleId(req.params), d);
  });
  api.post("/battles/:id/refuse", auth, async (req) => {
    await refuseChallenge(ctx, req.user.id, battleId(req.params));
    return { ok: true };
  });

  // Actions du duel : une transition à la fois par duel (même file que les échéances), puis l'état à jour.
  api.post("/battles/:id/attack", limited(60), async (req) => {
    const bid = battleId(req.params);
    const body = parse(z.object({ slot }), req.body);
    await serialAction(bid, () => chooseAttack(ctx, req.user.id, bid, body.slot));
    return battleState(ctx, req.user.id, bid);
  });
  api.post("/battles/:id/shield", limited(60), async (req) => {
    const bid = battleId(req.params);
    const body = parse(z.object({ slot }), req.body);
    await serialAction(bid, () => chooseShield(ctx, req.user.id, bid, body.slot));
    return battleState(ctx, req.user.id, bid);
  });
  api.post("/battles/:id/answer", limited(60), async (req) => {
    const bid = battleId(req.params);
    const { choice } = parse(z.object({ choice: z.number().int().min(0).max(3) }), req.body);
    await serialAction(bid, () => answerQuestion(ctx, req.user.id, bid, choice));
    return battleState(ctx, req.user.id, bid);
  });
  api.post("/battles/:id/forfeit", limited(10), async (req) => {
    const bid = battleId(req.params);
    await serialAction(bid, () => forfeit(ctx, req.user.id, bid));
    return battleState(ctx, req.user.id, bid);
  });

  // Écran du duel ouvert (ou reconnexion) : état complet, et démarrage quand les deux joueurs sont là.
  ctx.rt.onConnection((socket) => {
    socket.on("battle:join", (raw) => {
      const r = id.safeParse(raw);
      if (!r.success) return;
      const userId = socket.data.userId;
      void isParticipant(ctx, userId, r.data)
        .then((ok) => (ok ? battleEngine.join(ctx, userId, r.data) : undefined))
        .catch((err: unknown) => ctx.log.warn({ err, battleId: r.data }, "battle:join"));
    });
  });
  wireQueuePresence(ctx);
}
