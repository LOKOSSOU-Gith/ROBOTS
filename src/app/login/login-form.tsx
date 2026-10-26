"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, ApiClientError } from "@/lib/client-api";

export function LoginForm({ suite }: { suite: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      router.replace(suite);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.code === "rate_limited"
            ? "Trop de tentatives. Réessayez dans quelques minutes."
            : err.message
          : "Connexion impossible";
      setError(message);
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4" autoComplete="on">
      <div>
        <label className="label" htmlFor="email">
          Adresse e-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="input"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="admin@exemple.com"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••••••"
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {pending ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
