"use client";

import { Loader2, ShieldAlert, Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, ApiClientError } from "@/lib/client-api";

interface TestRow {
  status: string;
  resultCode: string | null;
  resultMessage: string | null;
  requestedAt: string | Date;
  completedAt: string | Date | null;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function ConnectionActions({
  accountId,
  environment,
  realApproved,
}: {
  accountId: string;
  environment: "demo" | "real";
  realApproved: boolean;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [realPhrase, setRealPhrase] = useState("");
  const [approving, setApproving] = useState(false);

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTest(null);
    try {
      await apiFetch(`/accounts/${accountId}/test-connection`, { method: "POST" });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await sleep(2000);
        const response = await apiFetch<{ test: TestRow | null }>(
          `/accounts/${accountId}/test-connection`,
        );
        if (response.test) {
          setTest(response.test);
          if (["connected", "failed"].includes(response.test.status)) break;
        }
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Test impossible");
    } finally {
      setTesting(false);
    }
  }

  async function removeAccount() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 6000);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/accounts/${accountId}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Suppression impossible");
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  async function approveReal() {
    setApproving(true);
    setError(null);
    try {
      await apiFetch(`/accounts/${accountId}/approve-real`, {
        method: "POST",
        body: { confirmation: realPhrase },
      });
      setRealPhrase("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Activation impossible");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary px-3 py-1.5 text-xs"
          onClick={testConnection}
          disabled={testing}
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Zap className="h-3.5 w-3.5" aria-hidden />
          )}
          {testing ? "Test en cours…" : "Tester la connexion"}
        </button>
        <button
          type="button"
          className={
            confirmingDelete
              ? "btn btn-danger px-3 py-1.5 text-xs"
              : "btn btn-outline px-3 py-1.5 text-xs text-destructive"
          }
          onClick={removeAccount}
          disabled={deleting}
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          )}
          {confirmingDelete ? "Confirmer la suppression" : "Supprimer le compte"}
        </button>
      </div>

      {testing ? (
        <p className="text-[11px] text-muted">
          Test délégué au moteur. Cette page vérifie le résultat toutes les 2 secondes.
        </p>
      ) : null}

      {test ? (
        <p
          className={`rounded-md border px-2.5 py-1.5 text-[11px] ${
            test.status === "connected"
              ? "border-success/30 bg-success/10 text-success"
              : test.status === "failed"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-info/30 bg-info/10 text-info"
          }`}
        >
          {test.status === "connected"
            ? "Connexion confirmée par le moteur."
            : test.status === "failed"
              ? `Échec : ${test.resultCode ?? "inconnu"} — ${test.resultMessage ?? "sans détail"}`
              : "Test en attente d'exécution par le moteur."}
        </p>
      ) : null}

      {environment === "real" ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            Activation du mode réel
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Aucun ordre réel ne sera envoyé avant cette activation. Vérifiez la connexion, les
            limites de risque, le symbole et le volume autorisés par le broker. Les performances
            passées ne garantissent rien.
          </p>
          {realApproved ? (
            <p className="mt-2 text-[11px] font-medium text-destructive">
              Mode réel déjà autorisé pour ce compte.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                className="input max-w-[180px] px-2 py-1 text-xs"
                value={realPhrase}
                onChange={(event) => setRealPhrase(event.target.value)}
                placeholder="MODE RÉEL"
                aria-label="Confirmation du mode réel"
              />
              <button
                type="button"
                className="btn btn-danger px-2.5 py-1 text-xs"
                disabled={approving || realPhrase !== "MODE RÉEL"}
                onClick={approveReal}
              >
                {approving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                Autoriser le mode réel
              </button>
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
