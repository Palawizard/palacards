"use client";

import useSWR from "swr";
import { api } from "./api";

/** Mode de connexion annoncé par l'API (`GET /api/config`). */
export type AuthMode = { mode: "password" } | { mode: "sso"; provider: string; accountUrl: string; signupUrl?: string };

/**
 * Emballe l'URL d'autorisation dans la page d'inscription d'Authentik : après la création du compte,
 * Authentik suit son `?next=` (relatif, même hôte) et la connexion reprend comme d'habitude.
 */
export function withSignup(authorizeUrl: string, signupUrl?: string): string {
  if (!signupUrl) return authorizeUrl;
  try {
    const authz = new URL(authorizeUrl);
    const signup = new URL(signupUrl);
    if (authz.host !== signup.host) return authorizeUrl;
    signup.searchParams.set("next", authz.pathname + authz.search);
    return signup.toString();
  } catch {
    return authorizeUrl;
  }
}

/** `undefined` tant que l'API n'a pas répondu. Sans réponse exploitable : pseudo + mot de passe. */
export function useAuthMode(): AuthMode | undefined {
  const { data, error } = useSWR("/config", (path: string) => api<{ auth?: AuthMode }>(path), {
    revalidateOnFocus: false,
  });
  if (error) return { mode: "password" };
  return data ? (data.auth ?? { mode: "password" }) : undefined;
}
