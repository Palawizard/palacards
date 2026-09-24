"use client";

import type { ClientToServerEvents, MeDTO, ServerToClientEvents } from "@palacards/shared";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import useSWR, { SWRConfig, type KeyedMutator } from "swr";
import { toast } from "sonner";
import { api, API_URL, ApiError, fetcher, SOCKET_PATH } from "./api";
import { describe } from "./notifications";
import { pushMedia } from "./media";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface GameContextValue {
  socket: GameSocket | null;
  /** Incrémenté à chaque (re)connexion : les abonnements aux salles doivent être refaits. */
  connection: number;
  me: MeDTO | undefined;
  mutateMe: KeyedMutator<MeDTO>;
}

const GameContext = createContext<GameContextValue | null>(null);

function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("GameProvider manquant");
  return ctx;
}

export const useMe = () => {
  const { me, mutateMe } = useGame();
  return { me, mutateMe };
};
export const useSocket = () => useGame().socket;
export const useConnection = () => useGame().connection;

/** Écoute un événement temps réel tant que le composant est monté. */
export function useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
  const socket = useSocket();
  const onEvent = useEffectEvent((...args: Parameters<ServerToClientEvents[E]>) => {
    (handler as (...a: Parameters<ServerToClientEvents[E]>) => void)(...args);
  });
  useEffect(() => {
    if (!socket) return;
    const listener = ((...args: Parameters<ServerToClientEvents[E]>) => onEvent(...args)) as never;
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

/**
 * Session de jeu : profil (`/me`), connexion Socket.IO unique et mises à jour en direct
 * du solde, du stock de paquets et des compteurs de non-lus.
 */
export function GameProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [connection, setConnection] = useState(0);
  const { data: me, mutate: mutateMe, error } = useSWR<MeDTO>("/me", fetcher);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace("/login");
  }, [error, router]);

  useEffect(() => {
    const s: GameSocket = io(API_URL || undefined, { path: SOCKET_PATH, withCredentials: true });
    s.on("wallet:update", (wallet) => void mutateMe((m) => (m ? { ...m, wallet } : m), { revalidate: false }));
    s.on("packs:update", (packs) => void mutateMe((m) => (m ? { ...m, packs } : m), { revalidate: false }));
    s.on("notification:new", (n) => {
      void mutateMe((m) => (m ? { ...m, unreadNotifications: n.unread } : m), { revalidate: false });
      const { text, href } = describe(n);
      toast(text, { action: { label: "Voir", onClick: () => router.push(href) } });
    });
    s.on("message:new", () => void mutateMe());
    s.on("card:media", pushMedia);
    // Exposé aux composants une fois connecté ; après une coupure, on relit l'état manqué.
    s.on("connect", () => {
      setSocket(s);
      setConnection((c) => c + 1);
      void mutateMe();
    });
    return () => {
      s.disconnect();
    };
  }, [mutateMe, router]);

  // Bonus de connexion du jour, réclamé une fois par chargement (le serveur l'accorde une fois par jour).
  // Aussi au retour sur l'onglet et après une reconnexion : un onglet ouvert passé minuit le touche.
  const loggedIn = !!me;
  useEffect(() => {
    if (!loggedIn) return;
    const claim = () =>
      api<{ claimed: boolean; reward?: number; streak?: number }>("/daily", { method: "POST" })
        .then((r) => {
          if (r.claimed)
            toast.success(
              `Bonus du jour : +${r.reward} PW${r.streak && r.streak > 1 ? ` (série de ${r.streak} jours)` : ""}`,
            );
        })
        .catch(() => {});
    void claim();
    const onVisible = () => document.visibilityState === "visible" && void claim();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loggedIn, connection]);

  return <GameContext.Provider value={{ socket, connection, me, mutateMe }}>{children}</GameContext.Provider>;
}

export function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        // Cache propre à la session : rien ne survit à une déconnexion (sortie des pages de jeu).
        provider: () => new Map(),
        fetcher,
        revalidateOnFocus: true,
        shouldRetryOnError: (err) => !(err instanceof ApiError && err.status < 500),
      }}
    >
      {children}
    </SWRConfig>
  );
}
