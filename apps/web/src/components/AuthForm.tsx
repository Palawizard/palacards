"use client";

import { usernameSchema } from "@palacards/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient, authErrorMessage } from "@/lib/auth-client";

/** Formulaire de connexion / inscription : pseudo + mot de passe, email facultatif. */
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const register = mode === "register";

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
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/pulls");
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
