"use client";

import { AlertOctagon, Loader2, Pause, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch, ApiClientError } from "@/lib/client-api";
import type { InstanceState } from "@/server/domain/states";

interface CommandResponse {
  commandId: string | null;
  status: string;
  state: InstanceState;
  alreadyInState: boolean;
}

export function RobotActions({
  robotId,
  state,
  accountConnected,
  startable,
}: {
  robotId: string;
  state: InstanceState;
  accountConnected: boolean;
  startable: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingEmergency, setConfirmingEmergency] = useState(false);

  useEffect(() => {
    if (!confirmingEmergency) return;
    const timer = window.setTimeout(() => setConfirmingEmergency(false), 6000);
    return () => window.clearTimeout(timer);
  }, [confirmingEmergency]);

  const stoppable = !["STOPPED", "STOPPING"].includes(state);
  const suspendable = ["RUNNING", "STARTING"].includes(state);

  async function run(action: string) {
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<CommandResponse>(`/robots/${robotId}/${action}`, {
        method: "POST",
      });
      if (result.alreadyInState) {
        setNotice(
          result.status === "already_started"
            ? "Ce robot est déjà en cours d'exécution."
            : "Aucune action nécessaire dans cet état.",
        );
      } else {
        setNotice(
          "Commande enregistrée. L'état sera affiché comme confirmé dès que le moteur l'aura acquittée.",
        );
      }
      router.refresh();
      // Le moteur acquitte en quelques secondes : on rafraîchit l'état confirmé.
      for (const delay of [2000, 5000, 9000]) {
        window.setTimeout(() => router.refresh(), delay);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Commande refusée");
    } finally {
      setPending(null);
    }
  }

  function emergency() {
    if (!confirmingEmergency) {
      setConfirmingEmergency(true);
      setNotice(null);
      setError(null);
      return;
    }
    setConfirmingEmergency(false);
    void run("emergency-stop");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary px-2.5 py-1.5 text-xs"
          onClick={() => run("start")}
          disabled={!startable || !accountConnected || pending !== null}
          title={
            !accountConnected
              ? "Testez d'abord la connexion MT5"
              : !startable
                ? "Un robot déjà actif ne peut pas être redémarré"
                : undefined
          }
        >
          {pending === "start" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden />
          )}
          Démarrer
        </button>

        <button
          type="button"
          className="btn btn-outline px-2.5 py-1.5 text-xs"
          onClick={() => run("suspend")}
          disabled={!suspendable || pending !== null}
          title="Bloque les nouvelles entrées, conserve les positions"
        >
          {pending === "suspend" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          )}
          Suspendre
        </button>

        <button
          type="button"
          className="btn btn-outline px-2.5 py-1.5 text-xs"
          onClick={() => run("stop")}
          disabled={!stoppable || pending !== null}
        >
          {pending === "stop" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Square className="h-3.5 w-3.5" aria-hidden />
          )}
          Arrêter
        </button>

        <button
          type="button"
          className={
            confirmingEmergency
              ? "btn btn-danger px-2.5 py-1.5 text-xs"
              : "btn btn-outline px-2.5 py-1.5 text-xs text-destructive"
          }
          onClick={emergency}
          disabled={!stoppable || pending !== null}
          title="Ferme toutes les positions de ce robot"
        >
          {pending === "emergency-stop" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <AlertOctagon className="h-3.5 w-3.5" aria-hidden />
          )}
          {confirmingEmergency ? "Confirmer la liquidation" : "Urgence"}
        </button>
      </div>

      {notice ? (
        <p role="status" className="rounded-md border border-info/30 bg-info/10 px-2.5 py-1.5 text-[11px] text-info">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
