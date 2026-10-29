import { Activity, ShieldCheck } from "lucide-react";

import { assertServerConfig } from "@/server/config";

import { LoginForm } from "./login-form";

export const metadata = { title: "Connexion — MT5 Control" };

// La page lit la configuration serveur : jamais de rendu statique au build.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string }>;
}) {
  assertServerConfig();
  const params = await searchParams;
  const suite = params.suite?.startsWith("/") && !params.suite.startsWith("//") ? params.suite : "/";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Activity className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">MT5 Control</h1>
            <p className="text-xs text-muted">Gestion de robots MetaTrader 5</p>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-semibold">Connexion administrateur</h2>
          <p className="mt-1 text-xs text-muted">
            Accès unique à votre espace. Toutes les actions sont journalisées.
          </p>
          <LoginForm suite={suite} />
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Session chiffrée par HTTPS, mot de passe MT5 chiffré au repos, aucune donnée
          d&apos;authentification dans le navigateur.
        </p>
      </div>
    </main>
  );
}
