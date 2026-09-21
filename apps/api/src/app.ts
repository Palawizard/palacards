import cors from "@fastify/cors";
import { createDb, type Db } from "@palacards/db";
import { MAX_STORED_PACKS, PACK_REGEN_MS } from "@palacards/game";
import Fastify from "fastify";
import { Server as SocketServer } from "socket.io";
import type { Config } from "./config.js";

export async function buildApp(config: Config) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });

  let db: Db | undefined;
  let closeDb: (() => Promise<void>) | undefined;
  if (config.DATABASE_URL) {
    const { db: instance, client } = createDb(config.DATABASE_URL);
    db = instance;
    closeDb = () => client.end();
  }

  const apiPrefix = `${config.BASE_PATH}/api`;

  await app.register(
    async (api) => {
      api.get("/health", async () => {
        let database: "up" | "down" | "not_configured" = "not_configured";
        if (db) {
          try {
            await db.execute("select 1");
            database = "up";
          } catch {
            database = "down";
          }
        }
        return { status: "ok", database, time: new Date().toISOString() };
      });

      api.get("/config", async () => ({
        maxStoredPacks: MAX_STORED_PACKS,
        packRegenMs: PACK_REGEN_MS,
      }));
    },
    { prefix: apiPrefix },
  );

  const io = new SocketServer(app.server, {
    path: `${config.BASE_PATH}/socket.io`,
    cors: { origin: config.WEB_ORIGIN, credentials: true },
  });

  io.on("connection", (socket) => {
    app.log.debug({ id: socket.id }, "socket connecté");
    socket.emit("hello", { serverTime: Date.now() });
  });

  app.addHook("onClose", async () => {
    io.close();
    await closeDb?.();
  });

  return { app, io };
}
