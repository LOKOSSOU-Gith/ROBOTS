"use client";

import { Loader2, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, ApiClientError } from "@/lib/client-api";

export function AccountForm({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [broker, setBroker] = useState("");
  const [server, setServer] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [environment, setEnvironment] = useState<"demo" | "real">("demo");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch("/accounts", {
        method: "POST",
        body: { broker, server, login, password, environment },
      });
      // Le mot de passe ne reste ni dans l'état React ni dans le stockage local.
      setPassword("");
      setSuccess("Compte enregistré. Testez maintenant la connexion avant de démarrer un robot.");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Enregistrement impossible");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="broker">
            Broker
          </label>
          <input
            id="broker"
            className="input"
            required
            maxLength={120}
            value={broker}
            onChange={(event) => setBroker(event.target.value)}
            placeholder="Ex. Peaks / IC Markets"
          />
        </div>
        <div>
          <label className="label" htmlFor="server">
            Serveur MT5 exact
          </label>
          <input
            id="server"
            className="input"
            required
            maxLength={120}
            value={server}
            onChange={(event) => setServer(event.target.value)}
            placeholder="Ex. Peaks-Demo"
          />
        </div>
        <div>
          <label className="label" htmlFor="login">
            Numéro de compte
          </label>
          <input
            id="login"
            className="input"
            required
            inputMode="numeric"
            pattern="\d{4,16}"
            maxLength={16}
            value={login}
            onChange={(event) => setLogin(event.target.value.replace(/\D/g, ""))}
            placeholder="12345678"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Mot de passe de trading
          </label>
          <input
            id="password"
            className="input"
            type="password"
            required
            autoComplete="new-password"
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div>
          <label className="label" htmlFor="environment">
            Environnement
          </label>
          <select
            id="environment"
            className="input"
            value={environment}
            onChange={(event) => setEnvironment(event.target.value as "demo" | "real")}
          >
            <option value="demo">Démo (recommandé)</option>
            <option value="real">Réel — autorisation séparée requise</option>
          </select>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Le mot de passe est chiffré (AES-256-GCM) avant stockage, transmis au moteur par un canal
        authentifié et jamais réaffiché. Utilisez un mot de passe de trading à permissions
        limitées, jamais vos identifiants de retrait.
      </p>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
          {success}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Enregistrer la connexion
      </button>
    </form>
  );
}
