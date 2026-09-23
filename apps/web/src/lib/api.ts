/** Base de l'API vue depuis le navigateur. En prod, même origine (chaîne vide). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
export const BASE_PATH = "/palacards";
export const API_BASE = `${API_URL}${BASE_PATH}/api`;
export const SOCKET_PATH = `${BASE_PATH}/socket.io`;

/** Erreur renvoyée par l'API : `message` est en français, affichable tel quel. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      credentials: "include",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, "network", "Serveur injoignable. Vérifie ta connexion.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? "Une erreur est survenue.");
  }
  return data as T;
}

/** Fetcher SWR. */
export const fetcher = <T>(path: string) => api<T>(path);
