import { GUILD_NAME_MAX, GUILD_TAG_MAX, MESSAGE_MAX_LENGTH } from "@palacards/game";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import {
  createGuild,
  guildDetail,
  joinGuild,
  leaveGuild,
  listGuilds,
  manageMember,
  membership,
  updateGuild,
} from "../services/guilds.js";
import {
  acceptFriend,
  conversations,
  history,
  listFriends,
  markChannelRead,
  removeFriend,
  requestFriend,
  sendMessage,
} from "../services/social.js";

const userIdParams = z.object({ userId: z.string().min(1).max(64) });
const channel = z.string().regex(/^(dm:[^:]+:[^:]+|guild:\d+)$/, "Conversation invalide");

export function socialRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };
  const limited = (max: number) => ({ ...auth, config: { rateLimit: { max, timeWindow: "1 minute" } } });

  // --- Amis ---
  api.get("/friends", auth, async (req) => listFriends(ctx, req.user.id));
  api.post("/friends", limited(20), async (req) => {
    const { username } = parse(z.object({ username: z.string().trim().min(1).max(30) }), req.body);
    return requestFriend(ctx, req.user.id, username);
  });
  api.post("/friends/:userId/accept", auth, async (req) => {
    await acceptFriend(ctx, req.user.id, parse(userIdParams, req.params).userId);
    return { ok: true };
  });
  api.delete("/friends/:userId", auth, async (req) => {
    await removeFriend(ctx, req.user.id, parse(userIdParams, req.params).userId);
    return { ok: true };
  });

  // --- Messages ---
  api.get("/messages", auth, async (req) => conversations(ctx, req.user.id));
  api.get("/messages/history", auth, async (req) => {
    const q = parse(z.object({ channel, before: z.coerce.number().int().positive().optional() }), req.query);
    return history(ctx, req.user.id, q.channel, q.before);
  });
  api.post("/messages", limited(40), async (req) => {
    const body = parse(
      z
        .object({
          to: z.string().trim().min(1).max(30).optional(),
          channel: channel.optional(),
          body: z.string().max(MESSAGE_MAX_LENGTH).default(""),
          instanceId: z.number().int().positive().optional(),
        })
        .refine((b) => b.to || b.channel, "Destinataire manquant"),
      req.body,
    );
    return sendMessage(ctx, req.user.id, body);
  });
  api.post("/messages/read", auth, async (req) => {
    const { channel: ch } = parse(z.object({ channel }), req.body);
    await markChannelRead(ctx, req.user.id, ch);
    return { ok: true };
  });

  // --- Guildes ---
  api.get("/guilds", auth, async () => listGuilds(ctx));
  api.get("/guilds/mine", auth, async (req) => {
    const me = await membership(ctx.db, req.user.id);
    return me ? { ...(await guildDetail(ctx, me.guildId)), myRole: me.role } : null;
  });
  api.get("/guilds/:id", auth, async (req) =>
    guildDetail(ctx, parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id),
  );
  api.post("/guilds", limited(5), async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(3).max(GUILD_NAME_MAX),
        tag: z.string().trim().min(2).max(GUILD_TAG_MAX),
        emblem: z.string().trim().min(1).max(4),
        description: z.string().trim().max(280).default(""),
      }),
      req.body,
    );
    return createGuild(ctx, req.user.id, body);
  });
  api.patch("/guilds/mine", auth, async (req) => {
    const body = parse(
      z.object({
        description: z.string().trim().max(280).optional(),
        emblem: z.string().trim().min(1).max(4).optional(),
      }),
      req.body,
    );
    await updateGuild(ctx, req.user.id, body);
    return { ok: true };
  });
  api.post("/guilds/:id/join", auth, async (req) => {
    await joinGuild(ctx, req.user.id, parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id);
    return { ok: true };
  });
  api.post("/guilds/leave", auth, async (req) => {
    await leaveGuild(ctx, req.user.id);
    return { ok: true };
  });
  api.post("/guilds/members/:userId/:action", auth, async (req) => {
    const p = parse(
      z.object({ userId: z.string().min(1).max(64), action: z.enum(["kick", "promote", "demote", "transfer"]) }),
      req.params,
    );
    await manageMember(ctx, req.user.id, p.userId, p.action);
    return { ok: true };
  });
}
