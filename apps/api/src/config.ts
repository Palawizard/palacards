import { z } from "zod";

const bool = z
  .enum(["0", "1", "true", "false", ""])
  .default("")
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  BASE_PATH: z
    .string()
    .default("/palacards")
    .refine(
      (v) => v === "" || (v.startsWith("/") && !v.endsWith("/")),
      "BASE_PATH doit commencer par / et ne pas finir par /",
    ),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional(),
  /** Origine publique de l'API, sans chemin (dev : http://localhost:4000, prod : https://palawi.fr). */
  BETTER_AUTH_URL: z.url().default("http://localhost:4000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET : 32 caractères minimum").optional(),
  WIKIMEDIA_USER_AGENT: z.string().default("PalaCards/0.1 (https://palawi.fr/palacards/)"),
  /** Désactive les appels Wikimedia (tests). */
  WIKIMEDIA_DISABLED: bool,
  /** Routes /api/test/* pour les E2E (jamais en prod). */
  GAME_TEST_MODE: bool,
  /** Derrière Caddy + Cloudflare : l'IP réelle vient des en-têtes. */
  TRUST_PROXY: bool,
  LOG_LEVEL: z.string().default("info"),
  /**
   * Connexion unique Authentik (OIDC), ex. https://auth.palawi.fr/application/o/palacards/.
   * Renseignée (avec l'identifiant et le secret) : la connexion par mot de passe est désactivée.
   * Absente (dev, CI) : pseudo + mot de passe comme avant.
   */
  AUTHENTIK_ISSUER: z.url().optional(),
  AUTHENTIK_CLIENT_ID: z.string().min(1).optional(),
  AUTHENTIK_CLIENT_SECRET: z.string().min(1).optional(),
  /**
   * Page d'inscription d'Authentik (ex. https://auth.palawi.fr/if/flow/inscription/), facultative.
   * « Créer mon compte » l'ouvre directement ; elle reprend ensuite la connexion par son ?next= relatif.
   */
  AUTHENTIK_ENROLLMENT_URL: z.url().optional(),
  /**
   * Page de suppression du compte palawi.fr (ex. https://auth.palawi.fr/if/flow/suppression-compte/), facultative.
   * Après l'effacement du compte PalaCards, le joueur y est envoyé pour effacer aussi son compte Authentik.
   * Absente (ou sur un autre hôte) : la page « Mon compte » d'Authentik, qui porte le même bouton.
   */
  AUTHENTIK_UNENROLLMENT_URL: z.url().optional(),
  /**
   * Suggestions automatisées : chaque nouvelle suggestion est triée par Claude (service `triage`), puis les
   * suggestions à coder partent en branche via GitHub Actions. Désactivé : rien n'est trié.
   */
  AUTOMATION_ENABLED: bool,
  /** Jeton partagé avec les workflows GitHub (POST /automation/…), 32 caractères au moins. */
  /**
   * Tri automatique au plus N suggestions par joueur sur 24 h (les suivantes attendent un clic « Trier avec
   * Claude » dans Admin). Les joueurs n'ont pas de plafond : ceci protège seulement le forfait Claude.
   */
  AUTOMATION_AUTO_TRIAGE_PER_USER: z.coerce.number().int().min(0).default(5),
  AUTOMATION_TOKEN: z.string().min(32, "AUTOMATION_TOKEN : 32 caractères minimum").optional(),
  /** Dépôt GitHub des issues et pull requests (liens de la page Admin). */
  GITHUB_REPOSITORY: z.string().default("Palawizard/palacards"),
  /** Webhook Discord (salon privé de l'admin) : tri, branches prêtes, échecs. */
  DISCORD_WEBHOOK_URL: z.url().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (
    config.NODE_ENV === "production" &&
    (!config.BETTER_AUTH_SECRET || config.BETTER_AUTH_SECRET.includes("change-me"))
  ) {
    // Le secret d'exemple de .env.example est public (repo GitHub) : jamais en production.
    throw new Error("BETTER_AUTH_SECRET est obligatoire en production (et pas la valeur d'exemple)");
  }
  if (config.NODE_ENV === "production" && !config.BETTER_AUTH_URL.startsWith("https://")) {
    // En http, le cookie de session partirait sans l'attribut Secure (et en clair).
    throw new Error(
      `BETTER_AUTH_URL doit être en https:// en production (reçu : ${config.BETTER_AUTH_URL}), sinon le cookie de session n'est pas sécurisé`,
    );
  }
  if (config.NODE_ENV === "production" && config.GAME_TEST_MODE) {
    throw new Error("GAME_TEST_MODE est interdit en production");
  }
  const sso = [config.AUTHENTIK_ISSUER, config.AUTHENTIK_CLIENT_ID, config.AUTHENTIK_CLIENT_SECRET];
  if (sso.some(Boolean) && !sso.every(Boolean)) {
    throw new Error("AUTHENTIK_ISSUER, AUTHENTIK_CLIENT_ID et AUTHENTIK_CLIENT_SECRET vont ensemble");
  }
  return config;
}

export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Page « Mon compte » d'Authentik (mot de passe, double authentification). */
  accountUrl: string;
  /** Page d'inscription, seulement si elle est sur l'hôte d'Authentik (Authentik n'accepte qu'un ?next= relatif). */
  signupUrl?: string;
  /** Suppression du compte palawi.fr : sur l'hôte d'Authentik, sinon la page « Mon compte ». */
  deleteAccountUrl: string;
}

/** Réglages de la connexion unique, ou null si la connexion par mot de passe est active. */
export function ssoConfig(config: Config): SsoConfig | null {
  const { AUTHENTIK_ISSUER: issuer, AUTHENTIK_CLIENT_ID: clientId, AUTHENTIK_CLIENT_SECRET: clientSecret } = config;
  if (!issuer || !clientId || !clientSecret) return null;
  const signup = config.AUTHENTIK_ENROLLMENT_URL;
  const unenroll = config.AUTHENTIK_UNENROLLMENT_URL;
  const host = new URL(issuer).host;
  const accountUrl = new URL("/if/user/#/settings", issuer).toString();
  return {
    issuer: issuer.endsWith("/") ? issuer : `${issuer}/`,
    clientId,
    clientSecret,
    accountUrl,
    ...(signup && new URL(signup).host === host ? { signupUrl: signup } : {}),
    // Jamais de redirection vers un autre hôte que celui d'Authentik (le joueur vient d'effacer son compte).
    deleteAccountUrl: unenroll && new URL(unenroll).host === host ? unenroll : accountUrl,
  };
}
