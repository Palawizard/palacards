/** Avatar d'un joueur : son emoji choisi, sinon l'initiale de son pseudo en serif ; pastille de présence facultative. */
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
        className={`grid ${dim} place-items-center rounded-full border border-line-strong bg-panel-2 font-display`}
        aria-hidden
      >
        {avatar ?? name.slice(0, 1).toUpperCase()}
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
