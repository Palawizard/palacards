import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

let n = 0;
/** Pseudo unique par exécution (la base E2E est recréée à chaque lancement). */
export const newName = (prefix: string) => `${prefix}${Date.now().toString(36).slice(-4)}${n++}`;

export const API = "http://localhost:4100/palacards/api";

// Contextes ouverts par newPlayer pendant le test en cours. Playwright ne ferme pas ceux créés
// à la main : ouverts tout le long de la suite, leurs pages (SWR, animations) la ralentissent.
let openContexts: { testId: string; contexts: BrowserContext[] } = { testId: "", contexts: [] };

/** Inscrit un joueur dans un nouveau contexte de navigateur (session isolée). */
export async function newPlayer(
  browser: Browser,
  prefix: string,
  options: BrowserContextOptions = {},
): Promise<{ page: Page; name: string }> {
  const { testId } = test.info();
  if (openContexts.testId !== testId) {
    // Nouveau test : on ferme les joueurs du précédent.
    await Promise.all(openContexts.contexts.map((c) => c.close()));
    openContexts = { testId, contexts: [] };
  }
  const context = await browser.newContext({ locale: "fr-FR", ...options });
  openContexts.contexts.push(context);
  const page = await context.newPage();
  const name = newName(prefix);
  await page.goto("register");
  await page.getByLabel("Pseudo").fill(name);
  await page.getByLabel("Mot de passe").fill("motdepasse123");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/palacards\/pulls$/);
  return { page, name };
}

/** Appel direct à l'API avec la session du joueur (cookies du contexte). */
export async function apiCall<T = unknown>(
  page: Page,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    data: body,
    headers: { origin: "http://localhost:3100" },
  });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Passe l'ouverture des paquets en mode instantané pour des tests rapides. */
export async function instantPacks(page: Page) {
  await apiCall(page, "PATCH", "/me/settings", { animationSpeed: "instant" });
}
