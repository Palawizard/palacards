"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { API_BASE, API_URL, SOCKET_PATH } from "@/lib/api";

type Health = { status: string; database: string } | null;

/** Vérifie que l'API (HTTP) et le temps réel (Socket.IO) répondent. */
export function ServerStatus() {
  const [health, setHealth] = useState<Health>(null);
  const [healthError, setHealthError] = useState(false);
  const [socketOk, setSocketOk] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealthError(true));

    const socket = io(API_URL || undefined, { path: SOCKET_PATH, transports: ["websocket", "polling"] });
    socket.on("connect", () => setSocketOk(true));
    socket.on("disconnect", () => setSocketOk(false));
    return () => {
      socket.disconnect();
    };
  }, []);

  const dot = (ok: boolean) => <span className={`inline-block size-2 rounded-full ${ok ? "bg-accent" : "bg-red-500"}`} />;

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-panel px-4 py-3 text-xs text-muted">
      <div className="flex items-center gap-2">
        {dot(!!health)} API : {health ? health.status : healthError ? "injoignable" : "…"}
      </div>
      <div className="flex items-center gap-2">
        {dot(health?.database === "up")} Base : {health?.database ?? "…"}
      </div>
      <div className="flex items-center gap-2">
        {dot(socketOk)} Temps réel : {socketOk ? "connecté" : "déconnecté"}
      </div>
    </div>
  );
}
