"use client";

import type { ClientToServerEvents, MeDTO, ServerToClientEvents } from "@palacards/shared";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import useSWR, { SWRConfig, type KeyedMutator } from "swr";
import { API_URL, ApiError, fetcher, SOCKET_PATH } from "./api";
import { pushMedia } from "./media";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface GameContextValue {
  socket: GameSocket | null;
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
  const { data: me, mutate: mutateMe, error } = useSWR<MeDTO>("/me", fetcher);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace("/login");
  }, [error, router]);

  useEffect(() => {
    const s: GameSocket = io(API_URL || undefined, { path: SOCKET_PATH, withCredentials: true });
    s.on("wallet:update", (wallet) => void mutateMe((m) => (m ? { ...m, wallet } : m), { revalidate: false }));
    s.on("packs:update", (packs) => void mutateMe((m) => (m ? { ...m, packs } : m), { revalidate: false }));
    s.on(
      "notification:new",
      (n) => void mutateMe((m) => (m ? { ...m, unreadNotifications: n.unread } : m), { revalidate: false }),
    );
    s.on("message:new", () => void mutateMe());
    s.on("card:media", pushMedia);
    // Exposé aux composants une fois connecté (aucun événement n'arrive avant).
    s.on("connect", () => setSocket(s));
    return () => {
      s.disconnect();
    };
  }, [mutateMe]);

  return <GameContext.Provider value={{ socket, me, mutateMe }}>{children}</GameContext.Provider>;
}

export function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: true,
        shouldRetryOnError: (err) => !(err instanceof ApiError && err.status < 500),
      }}
    >
      {children}
    </SWRConfig>
  );
}
