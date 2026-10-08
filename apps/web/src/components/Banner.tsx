"use client";

import type { BannerDTO } from "@palacards/shared";
import { ImageUp, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, API_BASE } from "@/lib/api";
import { prepareBanner } from "@/lib/avatar-image";

/** URL de la bannière importée d'un joueur (versionnée : le navigateur la garde en cache tant qu'elle ne change pas). */
export function bannerSrc(banner: BannerDTO): string {
  return `${API_BASE}/banners/${encodeURIComponent(banner.userId)}?v=${encodeURIComponent(banner.version)}`;
}

/**
 * Bannière en haut du profil : image importée par le joueur, sinon la couverture de l'album (bannière par défaut).
 * Sur son propre profil, boutons pour l'importer, la changer ou revenir au défaut.
 */
export function ProfileBanner({
  banner,
  isMe,
  onChanged,
}: {
  banner: BannerDTO | null;
  isMe: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      onChanged();
      toast.success(done);
    } catch (err) {
      // Erreur de l'API ou de la préparation de l'image (format, poids) : message déjà en français.
      toast.error(err instanceof Error ? err.message : "Bannière non enregistrée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pc-banner relative h-28 overflow-hidden rounded-xl border border-line sm:h-40">
      {banner && (
        // eslint-disable-next-line @next/next/no-img-element -- image servie par l'API (déjà réduite à 1200 × 300 px)
        <img
          key={banner.version}
          src={bannerSrc(banner)}
          alt=""
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {isMe && (
        <div className="absolute right-2 top-2 flex gap-1.5 sm:right-3 sm:top-3">
          <label
            className="btn btn-sm cursor-pointer has-[:disabled]:cursor-default has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            aria-busy={busy}
          >
            <ImageUp aria-hidden className="size-4" />
            {banner ? "Changer la bannière" : "Importer une bannière"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run(async () => {
                  const image = await prepareBanner(file);
                  await api("/me/banner", { method: "PUT", body: { image } });
                }, "Bannière mise à jour.");
              }}
            />
          </label>
          {banner && (
            <button
              type="button"
              className="btn btn-sm px-2"
              disabled={busy}
              onClick={() => run(() => api("/me/banner", { method: "DELETE" }), "Bannière par défaut rétablie.")}
              aria-label="Revenir à la bannière par défaut"
              title="Revenir à la bannière par défaut"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Bannière en fond d'une ligne de classement, fondue vers la gauche pour garder le nom lisible. */
export function RowBanner({ banner }: { banner: BannerDTO }) {
  // eslint-disable-next-line @next/next/no-img-element -- image servie par l'API (déjà réduite)
  return <img src={bannerSrc(banner)} alt="" loading="lazy" decoding="async" className="pc-row-banner" />;
}
