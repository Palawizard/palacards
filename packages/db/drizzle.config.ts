import { defineConfig } from "drizzle-kit";

// Charge le .env racine s'il existe (Node >= 22).
try {
  process.loadEnvFile("../../.env");
} catch {
  // pas de .env : on garde les variables d'environnement existantes
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://palacards:change-me@localhost:5432/palacards",
  },
});
