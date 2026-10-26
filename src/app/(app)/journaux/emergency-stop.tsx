"use client";

import { AlertOctagon, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, ApiClientError } from "@/lib/client-api";

export function EmergencyStopPanel() {
  const router = useRouter();
  const [phrase, setPhrase] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function stopAll() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiFetch<{ robots: number; commandIds: string[] }>(
        "/emergency-stop",
        {
          method: "POST",
          body: { confirmation: phrase },
        },
      );
      setPhrase("");
      setResult(
        response.robots === 0
          ? "Aucun robot actif : aucune liquidation nécessaire."
          : `${response.commandIds.length} commande(s) de liquidation envoyée(s) pour ${response.robots} robot(s). Vérifiez l'état confirmé ci-dessous.`,
      );
      router.refresh();
      for (const delay of [2000, 5000, 9000]) {
        window.setTimeout(() => router.refresh(), delay);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Arrêt d'urgence impossible");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-destructive/15 p-2 text-destructive">
          <AlertOctagon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-destructive">Arrêt d&apos;urgence</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Bloque immédiatement les nouvelles entrées de tous les robots et demande la fermeture
            de leurs positions. Cette action ne peut pas être annulée ; l&apos;exécution dépend du
            moteur et du broker. L&apos;état final est confirmé par accusé, pas par cette page.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[220px] px-2.5 py-1.5 text-xs"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder="ARRÊT D'URGENCE"
              aria-label="Texte de confirmation"
            />
            <button
              type="button"
              className="btn btn-danger text-xs"
              disabled={pending || phrase !== "ARRÊT D'URGENCE"}
              onClick={stopAll}
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <AlertOctagon className="h-3.5 w-3.5" aria-hidden />
              )}
              Tout arrêter et liquider
            </button>
          </div>
          {result ? (
            <p role="status" className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
              {result}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
