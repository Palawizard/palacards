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
  return config;
}
