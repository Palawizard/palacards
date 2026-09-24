import { schema, type Db } from "@palacards/db";
import { ECONOMY } from "@palacards/game";
import { usernameSchema } from "@palacards/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import { username } from "better-auth/plugins";
import type { IncomingHttpHeaders } from "node:http";
import type { Config } from "./config.js";

export const SESSION_COOKIE = "palawi_palacards_session";
const DEV_SECRET = "dev-only-secret-palacards-change-me-in-prod";

/** Routes qui révoquent des sessions : les sockets ouverts de ce joueur sont coupés (ceux encore valides se reconnectent). */
const REVOKING_PATHS = new Set(["/change-password", "/revoke-sessions", "/revoke-other-sessions", "/revoke-session", "/sign-out"]);

export function createAuth(db: Db, config: Config, events: { onSessionsRevoked?: (userId: string) => void } = {}) {
  const secure = config.BETTER_AUTH_URL.startsWith("https://");
  return betterAuth({
    secret: config.BETTER_AUTH_SECRET ?? DEV_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: `${config.BASE_PATH}/api/auth`,
    trustedOrigins: [config.WEB_ORIGIN],
    // Le profil (pseudo, avatar) passe par nos routes, qui protègent les pseudos admin : pas de modification directe.
    disabledPaths: ["/update-user", "/change-email"],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    advanced: {
      cookiePrefix: "palawi_palacards",
      // Pas de préfixe __Secure- : le nom du cookie reste celui de la convention SSO de Palawi.
      useSecureCookies: false,
      defaultCookieAttributes: { path: config.BASE_PATH || "/", sameSite: "lax", httpOnly: true, secure },
      cookies: { session_token: { name: SESSION_COOKIE } },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
    },
    rateLimit: {
      enabled: config.NODE_ENV === "production",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/username": { window: 60, max: 10 },
        "/sign-up/email": { window: 3600, max: 10 },
      },
    },
    hooks: {
      // Comptes sans email : le client n'envoie que pseudo + mot de passe (+ email facultatif).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email" || !ctx.body) return;
        const parsed = usernameSchema.safeParse(ctx.body.username);
        if (!parsed.success) {
          throw new APIError("BAD_REQUEST", { message: `Pseudo invalide : ${parsed.error.issues[0]?.message}` });
        }
        const name = parsed.data;
        const technical = `${name.toLowerCase()}@palacards.local`;
        const email = typeof ctx.body.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
        // Les adresses @palacards.local sont réservées : chacune correspond à un seul pseudo.
        if (email.endsWith("@palacards.local") && email !== technical) {
          throw new APIError("BAD_REQUEST", { message: "Adresse email réservée." });
        }
        ctx.body.email = email || technical;
        // Nom affiché = pseudo : sinon `displayUsername` permettait de s'afficher « Palawi » sous un autre pseudo.
        ctx.body.name = name;
        ctx.body.displayUsername = name;
        delete ctx.body.image;
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!REVOKING_PATHS.has(ctx.path)) return;
        const userId = ctx.context.session?.user.id;
        if (userId) events.onSessionsRevoked?.(userId);
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Exécuté après le commit de l'utilisateur : idempotent, et `ensurePlayer` rattrape un échec.
          after: async (u) => {
            await ensurePlayer(db, u.id);
          },
        },
      },
    },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 20 })],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Crée la fiche de jeu si elle n'existe pas encore (solde de départ tracé dans le ledger). */
export async function ensurePlayer(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const created = await tx
      .insert(schema.players)
      .values({ userId, balance: ECONOMY.startingBalance })
      .onConflictDoNothing()
      .returning({ userId: schema.players.userId });
    if (created.length > 0 && ECONOMY.startingBalance > 0) {
      await tx.insert(schema.ledger).values({
        userId,
        kind: "pw",
        delta: ECONOMY.startingBalance,
        balanceAfter: ECONOMY.startingBalance,
        reason: "signup",
      });
    }
  });
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export async function getSessionUser(
  auth: Auth,
  config: Config,
  headers: IncomingHttpHeaders,
): Promise<SessionUser | null> {
  const s = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!s) return null;
  const uname = (s.user.username ?? s.user.name).toLowerCase();
  return {
    id: s.user.id,
    username: uname,
    displayName: s.user.displayUsername ?? s.user.name,
    isAdmin: config.ADMIN_USERNAMES.includes(uname),
  };
}
