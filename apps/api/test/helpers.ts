import type { FastifyInstance } from "fastify";
import { buildApp, type BuildOptions } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import { progressionIdle } from "../src/services/progression.js";
import { setAdminRole } from "../src/services/roles.js";
import { sql } from "@palacards/db";

try {
  process.loadEnvFile("../../.env");
} catch {
  // CI : variables déjà présentes
}

/** URL de la base de test (même serveur que DATABASE_URL, base `palacards_test`). */
export function testDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://palacards:change-me@localhost:5433/palacards");
  url.pathname = "/palacards_test";
  return url.toString();
}

export async function makeApp(options: BuildOptions = {}) {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: testDatabaseUrl(),
    WIKIMEDIA_DISABLED: "1",
    LOG_LEVEL: "warn",
    NODE_ENV: "test",
    GAME_TEST_MODE: "1",
  });
  const { app, ctx } = await buildApp(config, options);
  await app.ready();
  return { app, ctx: ctx as Ctx };
}

let counter = 0;
/** Pseudo unique par test (la base est partagée entre fichiers). */
export const uniqueName = (prefix = "joueur") => `${prefix}${Date.now().toString(36).slice(-5)}${counter++}`;

export interface Client {
  userId: string;
  username: string;
  cookie: string;
  get: (url: string) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any -- réponses JSON libres dans les tests
  post: (url: string, body?: unknown) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any -- idem
  put: (url: string, body?: unknown) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any -- idem
}

export async function signUp(
  app: FastifyInstance,
  username = uniqueName(),
  password = "motdepasse123",
): Promise<Client> {
  const res = await app.inject({
    method: "POST",
    url: "/palacards/api/auth/sign-up/email",
    headers: { origin: "http://localhost:3000" },
    payload: { username, password },
  });
  if (res.statusCode !== 200) throw new Error(`inscription échouée (${res.statusCode}) : ${res.body}`);
  const setCookie = [res.headers["set-cookie"]].flat().filter(Boolean) as string[];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const call = async (method: "GET" | "POST" | "PUT", url: string, body?: unknown) => {
    const r = await app.inject({
      method,
      url: `/palacards/api${url}`,
      headers: { cookie, origin: "http://localhost:3000" },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  const me = await call("GET", "/me");
  return {
    userId: me.body.id,
    username,
    cookie,
    get: (url) => call("GET", url),
    post: (url, body) => call("POST", url, body ?? {}),
    put: (url, body) => call("PUT", url, body ?? {}),
  };
}

/** Inscrit un joueur et lui donne le rôle admin (comme la CLI). */
export async function signUpAdmin(app: FastifyInstance, ctx: Ctx, username = uniqueName("admin")): Promise<Client> {
  const client = await signUp(app, username);
  await setAdminRole(ctx.db, username, true);
  return client;
}

/** PW gagnés par les succès (traités en arrière-plan) : attend leur fin puis lit le ledger. */
export async function achievementPw(ctx: Ctx, userId: string): Promise<number> {
  await progressionIdle();
  const [row] = await ctx.db.execute<{ n: string }>(
    sql`select coalesce(sum(delta), 0) as n from ledger where user_id = ${userId} and kind = 'pw' and reason = 'achievement'`,
  );
  return Number(row?.n ?? 0);
}
