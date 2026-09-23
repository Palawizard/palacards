import type { ClientToServerEvents, ServerToClientEvents } from "@palacards/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { getSessionUser, type Auth } from "./auth.js";
import type { Config } from "./config.js";

interface SocketData {
  userId: string;
  username: string;
}

export type Io = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type Emit = Parameters<Io["emit"]>;

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Socket.IO : handshake authentifié par le cookie de session, une room par utilisateur.
 * La présence (qui est connecté) est tenue en mémoire : un seul process API.
 */
export function createRealtime(server: HttpServer, config: Config, auth: Auth | undefined, log: FastifyBaseLogger) {
  const io: Io = new Server(server, {
    path: `${config.BASE_PATH}/socket.io`,
    cors: { origin: config.WEB_ORIGIN, credentials: true },
  });
  const online = new Map<string, number>();
  const onConnect: ((socket: Parameters<Parameters<Io["on"]>[1]>[0]) => void)[] = [];
  const presenceListeners: ((userId: string, isOnline: boolean) => void)[] = [];

  io.use(async (socket, next) => {
    if (!auth) return next(new Error("unauthorized"));
    try {
      const user = await getSessionUser(auth, config, socket.request.headers);
      if (!user) return next(new Error("unauthorized"));
      socket.data.userId = user.id;
      socket.data.username = user.username;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on("connection", (socket) => {
    const { userId } = socket.data;
    void socket.join(userRoom(userId));
    const count = (online.get(userId) ?? 0) + 1;
    online.set(userId, count);
    if (count === 1) presenceListeners.forEach((l) => l(userId, true));
    socket.on("disconnect", () => {
      const left = (online.get(userId) ?? 1) - 1;
      if (left <= 0) {
        online.delete(userId);
        presenceListeners.forEach((l) => l(userId, false));
      } else online.set(userId, left);
    });
    for (const handler of onConnect) {
      try {
        handler(socket);
      } catch (err) {
        log.error(err);
      }
    }
  });

  return {
    io,
    /** Envoie un événement à toutes les connexions d'un joueur. */
    toUser<E extends Emit[0]>(userId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
      io.to(userRoom(userId)).emit(event, ...args);
    },
    toRoom<E extends Emit[0]>(room: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
      io.to(room).emit(event, ...args);
    },
    isOnline: (userId: string) => online.has(userId),
    onlineUsers: () => [...online.keys()],
    /** Enregistre des gestionnaires d'événements client (marché, duels…). */
    onConnection(handler: (typeof onConnect)[number]) {
      onConnect.push(handler);
    },
    onPresence(listener: (userId: string, isOnline: boolean) => void) {
      presenceListeners.push(listener);
    },
    disconnectUser(userId: string) {
      io.in(userRoom(userId)).disconnectSockets(true);
    },
  };
}

export type Realtime = ReturnType<typeof createRealtime>;
