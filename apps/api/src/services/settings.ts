import { eq, schema, sql } from "@palacards/db";
import { usernameSchema } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict } from "../errors.js";

/**
 * Change le pseudo (unique, insensible à la casse). Le rôle admin est attaché au compte
 * (colonne `user.is_admin`), pas au pseudo : renommer ne donne ni ne retire aucun droit.
 */
export async function changeUsername(ctx: Ctx, userId: string, _currentUsername: string, wanted: string) {
  const parsed = usernameSchema.safeParse(wanted);
  if (!parsed.success) throw badRequest("invalid_username", parsed.error.issues[0]?.message ?? "Pseudo invalide.");
  const display = parsed.data;
  const lower = display.toLowerCase();
  await ctx.db
    .transaction(async (tx) => {
      const [taken] = await tx.execute<{ id: string }>(
        sql`select id from "user" where username = ${lower} and id <> ${userId}`,
      );
      if (taken) throw conflict("username_taken", "Ce pseudo est déjà pris.");
      // L'adresse technique suit le pseudo : l'ancien pseudo redevient libre.
      await tx
        .update(schema.user)
        .set({
          username: lower,
          displayUsername: display,
          name: display,
          email: sql`case when ${schema.user.email} like '%@palacards.local' then ${`${lower}@palacards.local`} else ${schema.user.email} end`,
        })
        .where(eq(schema.user.id, userId));
    })
    .catch((err: unknown) => {
      // Deux renommages simultanés vers le même pseudo : la contrainte unique tranche.
      if (
        (err as { code?: string; cause?: { code?: string } }).code === "23505" ||
        (err as { cause?: { code?: string } }).cause?.code === "23505"
      ) {
        throw conflict("username_taken", "Ce pseudo est déjà pris.");
      }
      throw err;
    });
  return { username: lower, displayName: display };
}
