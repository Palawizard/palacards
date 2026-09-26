"use client";

import useSWR from "swr";
import { api } from "./api";

/** Mode de connexion annoncé par l'API (`GET /api/config`). */
export type AuthMode = { mode: "password" } | { mode: "sso"; provider: string; accountUrl: string };

/** `undefined` tant que l'API n'a pas répondu. Sans réponse exploitable : pseudo + mot de passe. */
export function useAuthMode(): AuthMode | undefined {
  const { data, error } = useSWR("/config", (path: string) => api<{ auth?: AuthMode }>(path), {
    revalidateOnFocus: false,
  });
  if (error) return { mode: "password" };
  return data ? (data.auth ?? { mode: "password" }) : undefined;
}
