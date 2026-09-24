import { defineConfig, devices } from "@playwright/test";

// Parcours de bout en bout sur une base dédiée (palacards_e2e) et des ports dédiés,
// pour ne pas gêner un `pnpm dev` déjà lancé. Le front est construit dans .next-e2e.
const API = "http://localhost:4100";

function e2eDatabaseUrl(): string {
  try {
    process.loadEnvFile("../../.env");
  } catch {
    // CI
  }
  const url = new URL(process.env.DATABASE_URL ?? "postgres://palacards:change-me@localhost:5433/palacards");
  url.pathname = "/palacards_e2e";
  return url.toString();
}
const WEB = "http://localhost:3100";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    // GitHub Actions : échecs recopiés dans le résumé du run.
    ...(process.env.GITHUB_STEP_SUMMARY ? ([["./summary-reporter.ts"]] as const) : []),
  ],
  use: { baseURL: `${WEB}/palacards/`, trace: "retain-on-failure", locale: "fr-FR" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "api",
      command: "node --env-file-if-exists=../../.env ../api/dist/server.js",
      url: `${API}/palacards/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        API_PORT: "4100",
        WEB_ORIGIN: WEB,
        BETTER_AUTH_URL: API,
        DATABASE_URL: e2eDatabaseUrl(),
        GAME_TEST_MODE: "1",
        WIKIMEDIA_DISABLED: "1",
        LOG_LEVEL: "warn",
      },
    },
    {
      name: "web",
      command: "pnpm --filter @palacards/web exec next start --port 3100",
      url: `${WEB}/palacards/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NEXT_DIST_DIR: ".next-e2e" },
    },
  ],
});
