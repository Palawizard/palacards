import { asc, eq, schema, sql, type Db } from "@palacards/db";

/**
 * Rôle admin : colonne `user.is_admin`, changée seulement par la CLI (`src/cli/admin.ts`)
 * ou, en mode test, par `/api/test/make-admin`. Jamais déduit du pseudo.
 * Module sans dépendance au reste de l'API : la CLI l'importe sans démarrer l'app.
 */
export async function setAdminRole(db: Db, username: string, isAdmin: boolean) {
  const [row] = await db
    .update(schema.user)
    .set({ isAdmin })
    .where(eq(schema.user.username, username.trim().toLowerCase()))
    .returning({ id: schema.user.id, username: schema.user.username });
  return row ?? null;
}

export async function listAdmins(db: Db): Promise<string[]> {
  const rows = await db
    .select({ username: sql<string>`coalesce(${schema.user.username}, ${schema.user.name})` })
    .from(schema.user)
    .where(eq(schema.user.isAdmin, true))
    .orderBy(asc(schema.user.username));
  return rows.map((r) => r.username);
}

export const ADMIN_CLI_USAGE = "Usage : node dist/cli/admin.js grant <pseudo> | revoke <pseudo> | list";

/** Exécute une commande de la CLI admin ; renvoie le code de sortie et le message à afficher. */
export async function adminCommand(db: Db, args: string[]): Promise<{ code: number; message: string }> {
  const [command, username] = args;
  if (command === "list" && !username) {
    const admins = await listAdmins(db);
    return { code: 0, message: admins.length ? `Admins : ${admins.join(", ")}` : "Aucun admin." };
  }
  if ((command === "grant" || command === "revoke") && username && args.length === 2) {
    const row = await setAdminRole(db, username, command === "grant");
    if (!row) return { code: 1, message: `Joueur introuvable : ${username}` };
    return {
      code: 0,
      message: command === "grant" ? `${row.username} est maintenant admin.` : `${row.username} n'est plus admin.`,
    };
  }
  return { code: 2, message: ADMIN_CLI_USAGE };
}
