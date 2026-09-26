import { eq, or, schema, type Db } from "@palacards/db";
import { ECONOMY, MAX_STORED_PACKS } from "@palacards/game";
import { usernameSchema } from "@palacards/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import { genericOAuth, username } from "better-auth/plugins";
import { randomInt } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { ssoConfig, type Config } from "./config.js";

export const SESSION_COOKIE = "palawi_palacards_session";
const DEV_SECRET = "dev-only-secret-palacards-change-me-in-prod";

/** Identifiant du fournisseur Authentik (URL de retour : `${BASE_PATH}/api/auth/callback/authentik`). */
export const SSO_PROVIDER_ID = "authentik";

/** Routes du mot de passe local, coupées quand la connexion passe par Authentik. */
const PASSWORD_PATHS = [
  "/sign-in/email",
  "/sign-in/username",
  "/sign-up/email",
  "/change-password",
  "/set-password",
  "/request-password-reset",
  "/reset-password",
];

/** Routes qui révoquent des sessions : les sockets ouverts de ce joueur sont coupés (ceux encore valides se reconnectent). */
const REVOKING_PATHS = new Set([
  "/change-password",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/revoke-session",
  "/sign-out",
]);

export function createAuth(db: Db, config: Config, events: { onSessionsRevoked?: (userId: string) => void } = {}) {
  const secure = config.BETTER_AUTH_URL.startsWith("https://");
  const sso = ssoConfig(config);
  return betterAuth({
    secret: config.BETTER_AUTH_SECRET ?? DEV_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: `${config.BASE_PATH}/api/auth`,
    trustedOrigins: [config.WEB_ORIGIN],
    // Le profil (pseudo, avatar) passe par nos routes : pas de modification directe.
    // Avec Authentik, les comptes et mots de passe se gèrent sur auth.palawi.fr.
    disabledPaths: ["/update-user", "/change-email", ...(sso ? PASSWORD_PATHS : [])],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    user: {
      additionalFields: {
        // Rôle admin stocké en base, jamais modifiable par l'utilisateur (`input: false` : ignoré à l'inscription).
        // Seule la CLI (`src/cli/admin.ts`) le change.
        isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    emailAndPassword: { enabled: !sso, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    // Jamais de rattachement par email : Authentik ne vérifie pas les adresses à l'inscription.
    // Un compte Authentik ne retrouve un joueur que par son identifiant (table account).
    account: { accountLinking: { enabled: false } },
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
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 20 }),
      genericOAuth({
        config: sso
          ? [
              {
                providerId: SSO_PROVIDER_ID,
                name: "Authentik",
                discoveryUrl: `${sso.issuer}.well-known/openid-configuration`,
                clientId: sso.clientId,
                clientSecret: sso.clientSecret,
                scopes: ["openid", "profile"],
                pkce: true,
                requireIdTokenVerification: true,
                mapProfileToUser: async (profile) => {
                  const pseudo = await freeUsername(db, profile.preferred_username ?? profile.name);
                  // Même convention que l'inscription sans email : adresse technique unique par pseudo.
                  return {
                    name: pseudo,
                    username: pseudo.toLowerCase(),
                    displayUsername: pseudo,
                    email: `${pseudo.toLowerCase()}@palacards.local`,
                    emailVerified: false,
                    image: undefined,
                  };
                },
              },
            ]
          : [],
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Pseudo libre dérivé du nom Authentik (règles de `usernameSchema`, suffixe si déjà pris). */
export async function freeUsername(db: Db, wanted: unknown): Promise<string> {
  let base = (typeof wanted === "string" ? wanted : "").replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 20);
  if (!usernameSchema.safeParse(base).success) base = "joueur";
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 15)}_${randomInt(1000, 10000)}`;
    const lower = candidate.toLowerCase();
    const taken = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(or(eq(schema.user.username, lower), eq(schema.user.email, `${lower}@palacards.local`)))
      .limit(1);
    if (taken.length === 0) return candidate;
  }
  throw new Error("Aucun pseudo libre trouvé");
}

/** Crée la fiche de jeu si elle n'existe pas encore (solde de départ tracé dans le ledger). */
export async function ensurePlayer(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const created = await tx
      .insert(schema.players)
      // Stock plein à l'inscription.
      .values({ userId, balance: ECONOMY.startingBalance, packsStored: MAX_STORED_PACKS })
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

/** Utilisateur de la session (relu en base à chaque appel : un rôle retiré prend effet tout de suite). */
export async function getSessionUser(auth: Auth, headers: IncomingHttpHeaders): Promise<SessionUser | null> {
  const s = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!s) return null;
  return {
    id: s.user.id,
    username: (s.user.username ?? s.user.name).toLowerCase(),
    displayName: s.user.displayUsername ?? s.user.name,
    isAdmin: s.user.isAdmin === true,
  };
}
