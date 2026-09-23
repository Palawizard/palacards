"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/game";

/** « Profil » dans le menu : redirige vers la page publique du joueur connecté. */
export default function MyProfile() {
  const { me } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me) router.replace(`/u/${me.username}`);
  }, [me, router]);
  return <div className="h-40 animate-pulse rounded-md bg-panel" aria-busy />;
}
