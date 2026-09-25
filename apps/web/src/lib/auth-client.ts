"use client";

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { API_URL, BASE_PATH } from "./api";

export const authClient = createAuthClient({
  baseURL: API_URL || (typeof window !== "undefined" ? window.location.origin : undefined),
  basePath: `${BASE_PATH}/api/auth`,
  fetchOptions: { credentials: "include" },
  plugins: [usernameClient()],
});

/** Messages d'erreur Better Auth traduits. */
export function authErrorMessage(code: string | undefined, fallback?: string): string {
  switch (code) {
    case "USERNAME_IS_ALREADY_TAKEN":
    case "USERNAME_IS_ALREADY_TAKEN_PLEASE_TRY_ANOTHER":
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Ce pseudo est déjà pris.";
    case "INVALID_USERNAME_OR_PASSWORD":
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Pseudo ou mot de passe incorrect.";
    case "PASSWORD_TOO_SHORT":
      return "Mot de passe trop court (8 caractères minimum).";
    case "USERNAME_TOO_SHORT":
      return "Pseudo trop court (3 caractères minimum).";
    case "USERNAME_TOO_LONG":
      return "Pseudo trop long (20 caractères maximum).";
    case "INVALID_USERNAME":
      return "Pseudo invalide : lettres, chiffres, _ et . uniquement.";
    default:
      return fallback ?? "Connexion impossible pour le moment.";
  }
}
