import { avatarImage } from "@palacards/shared";
import { API_BASE } from "@/lib/api";

/** URL de la photo importée d'un joueur (versionnée : le navigateur la garde en cache tant qu'elle ne change pas). */
export function avatarSrc(avatar: string | null | undefined): string | null {
  const ref = avatarImage(avatar);
  return ref ? `${API_BASE}/avatars/${encodeURIComponent(ref.userId)}?v=${encodeURIComponent(ref.version)}` : null;
}

/** Contenu d'une pastille d'avatar : photo importée, emoji choisi, sinon l'initiale du pseudo. */
export function AvatarFace({ name, avatar }: { name: string; avatar: string | null }) {
  const src = avatarSrc(avatar);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- photo servie par l'API (déjà réduite à 256 px)
    return <img src={src} alt="" loading="lazy" decoding="async" className="size-full rounded-full object-cover" />;
  }
  return <>{avatar ?? name.slice(0, 1).toUpperCase()}</>;
}

/** Avatar d'un joueur ; pastille de présence facultative. */
export function Avatar({
  name,
  avatar,
  online,
  size = "md",
}: {
  name: string;
  avatar: string | null;
  online?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "size-8 text-base" : size === "lg" ? "size-16 text-3xl" : "size-10 text-lg";
  return (
    <span className="relative shrink-0">
      <span
        className={`grid ${dim} place-items-center overflow-hidden rounded-full border border-line-strong bg-panel-2 font-display`}
        aria-hidden
      >
        <AvatarFace name={name} avatar={avatar} />
      </span>
      {online !== undefined && (
        <>
          <span
            aria-hidden
            className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-panel ${online ? "bg-accent" : "bg-line-strong"}`}
          />
          <span className="sr-only">{online ? "en ligne" : "hors ligne"}</span>
        </>
      )}
    </span>
  );
}
