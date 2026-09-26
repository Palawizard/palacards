"use client";

import { usernameSchema } from "@palacards/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { BASE_PATH } from "@/lib/api";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { useAuthMode, withSignup } from "@/lib/auth-mode";

/** Chemin interne où revenir après la connexion (`?next=`), sinon les paquets. */
function nextPath(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/pulls";
}

/**
 * Connexion / inscription. En production, un bouton vers Authentik (auth.palawi.fr) ;
 * sans connexion unique configurée (dev, CI) : pseudo + mot de passe, email facultatif.
 */
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const register = mode === "register";
  const authMode = useAuthMode();

  if (!authMode) {
    return <p className="text-sm text-muted">Un instant…</p>;
  }

  if (authMode.mode === "sso") {
    const ssoFailed = params.get("erreur") === "sso";
    return (
      <div className="flex flex-col gap-4">
        {ssoFailed && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            La connexion n&apos;a pas abouti. Réessaie.
          </p>
        )}
        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const origin = window.location.origin;
            const signup = register && authMode.signupUrl;
            const res = await authClient.signIn.social({
              provider: authMode.provider,
              callbackURL: `${origin}${BASE_PATH}${nextPath(params.get("next"))}`,
              errorCallbackURL: `${origin}${BASE_PATH}/login?erreur=sso`,
              // Inscription : on récupère l'URL d'autorisation pour l'emballer dans la page d'inscription.
              ...(signup ? { disableRedirect: true } : {}),
            });
            if (res.error) {
              setPending(false);
              setError(authErrorMessage(res.error.code, res.error.message));
              return;
            }
            if (signup && res.data?.url) window.location.assign(withSignup(res.data.url, authMode.signupUrl));
          }}
        >
          {pending ? "Un instant…" : register ? "Créer mon compte" : "Se connecter"}
        </button>
        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <p className="text-center text-sm text-muted">
          {register
            ? authMode.signupUrl
              ? "Ton compte palawi.fr servira pour toutes les apps de palawi.fr."
              : "Ton compte palawi.fr sert pour toutes les apps : sur la page qui s’ouvre, choisis « Créer un compte »."
            : "Un seul compte pour toutes les apps de palawi.fr."}
        </p>
      </div>
    );
  }

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    if (register) {
      const check = usernameSchema.safeParse(username);
      if (!check.success) return setError(check.error.issues[0]?.message ?? "Pseudo invalide.");
      if (password.length < 8) return setError("Mot de passe trop court (8 caractères minimum).");
    }
    setPending(true);
    const res = register
      ? await authClient.signUp.email({
          username: username.trim(),
          password,
          // L'email est facultatif : le serveur en génère un technique s'il est vide.
          email: email.trim() || `${username.trim().toLowerCase()}@palacards.local`,
          name: username.trim(),
        })
      : await authClient.signIn.username({ username: username.trim(), password });
    setPending(false);
    if (res.error) return setError(authErrorMessage(res.error.code, res.error.message));
    router.replace(nextPath(params.get("next")));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div>
        <label className="label" htmlFor="username">
          Pseudo
        </label>
        <input
          id="username"
          className="field"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          maxLength={20}
        />
        {register && <p className="mt-1 text-xs text-faint">3 à 20 caractères : lettres, chiffres, _ et .</p>}
      </div>
      <div>
        <label className="label" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          className="field"
          autoComplete={register ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={register ? 8 : undefined}
        />
      </div>
      {register && (
        <div>
          <label className="label" htmlFor="email">
            Email <span className="font-normal text-faint">(facultatif)</span>
          </label>
          <input
            id="email"
            type="email"
            className="field"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary mt-1 w-full" disabled={pending}>
        {pending ? "Un instant…" : register ? "Créer mon compte" : "Se connecter"}
      </button>
      <p className="text-center text-sm text-muted">
        {register ? (
          <>
            Déjà inscrit ?{" "}
            <Link href="/login" className="article-link">
              Se connecter
            </Link>
          </>
        ) : (
          <>
            Pas encore de compte ?{" "}
            <Link href="/register" className="article-link">
              Créer un compte
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
