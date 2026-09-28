import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "palawi_palacards_session";
// Pages publiques, plus les fichiers lus par les robots et les aperçus de liens (sans session).
const PUBLIC = [
  "/login",
  "/register",
  "/confidentialite",
  "/opengraph-image",
  "/sitemap.xml",
  "/manifest.webmanifest",
];

/** Redirige vers la connexion sans cookie de session (le serveur revérifie la session à chaque appel). */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|svg|ico|webp)$).*)"],
};
