"use client";

import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiFetch, ApiClientError } from "@/lib/client-api";
import type { ParameterSchema } from "@/server/domain/parameters";
import { TIMEFRAMES } from "@/server/domain/robotSettings";

interface SettingsInitial {
  robotId: string;
  symbol: string;
  timeframe: string;
  initialLot: string;
  profitTargetNet: string;
  maxLossNet: string;
  profitReference: "session" | "day";
  maxTrades: number;
  maxPositions: number;
  maxSpreadPoints: number;
  allowedHours: { start: number; end: number };
  stopPolicy: "keep_positions" | "close_positions";
  parameters: Record<string, unknown>;
  parameterSchema: ParameterSchema;
  supportedSymbols: string[];
  live: boolean;
}

export function RobotSettingsForm({ initial }: { initial: SettingsInitial }) {
  const router = useRouter();
  const [symbol, setSymbol] = useState(initial.symbol);
  const [timeframe, setTimeframe] = useState(initial.timeframe);
  const [initialLot, setInitialLot] = useState(initial.initialLot);
  const [profitTargetNet, setProfitTargetNet] = useState(initial.profitTargetNet);
  const [maxLossNet, setMaxLossNet] = useState(initial.maxLossNet);
  const [profitReference, setProfitReference] = useState(initial.profitReference);
  const [maxTrades, setMaxTrades] = useState(String(initial.maxTrades));
  const [maxPositions, setMaxPositions] = useState(String(initial.maxPositions));
  const [maxSpreadPoints, setMaxSpreadPoints] = useState(String(initial.maxSpreadPoints));
  const [hoursStart, setHoursStart] = useState(String(initial.allowedHours.start));
  const [hoursEnd, setHoursEnd] = useState(String(initial.allowedHours.end));
  const [stopPolicy, setStopPolicy] = useState(initial.stopPolicy);
  const [parameters, setParameters] = useState<Record<string, unknown>>(initial.parameters);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function updateParameter(key: string, value: unknown) {
    setParameters((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiFetch<{ commandId: string | null; reloadRequired: boolean }>(
        `/robots/${initial.robotId}`,
        {
          method: "PATCH",
          body: {
            symbol,
            timeframe,
            initialLot,
            profitTargetNet,
            maxLossNet,
            profitReference,
            maxTrades: Number(maxTrades),
            maxPositions: Number(maxPositions),
            maxSpreadPoints: Number(maxSpreadPoints),
            allowedHours: { start: Number(hoursStart), end: Number(hoursEnd) },
            stopPolicy,
            strategyParameters: parameters,
          },
        },
      );
      setSuccess(
        result.reloadRequired
          ? "Paramètres enregistrés. Le moteur a reçu une demande de rechargement à chaud."
          : "Paramètres enregistrés et validés côté serveur.",
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Enregistrement refusé");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label" htmlFor="symbol">
            Symbole
          </label>
          <select
            id="symbol"
            className="input"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
          >
            {initial.supportedSymbols.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="timeframe">
            Timeframe
          </label>
          <select
            id="timeframe"
            className="input"
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value)}
          >
            {TIMEFRAMES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="initialLot">
            Lot initial
          </label>
          <input
            id="initialLot"
            className="input"
            inputMode="decimal"
            required
            value={initialLot}
            onChange={(event) => setInitialLot(event.target.value)}
            pattern="^\d+(\.\d{1,8})?$"
          />
          <p className="mt-1 text-[10px] text-muted">
            Le volume réel est dérivé de l&apos;équité et du risque, jamais doublé après une perte.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="profitTargetNet">
            Objectif de gain net
          </label>
          <input
            id="profitTargetNet"
            className="input"
            inputMode="decimal"
            required
            value={profitTargetNet}
            onChange={(event) => setProfitTargetNet(event.target.value)}
            pattern="^\d+(\.\d{1,8})?$"
          />
        </div>
        <div>
          <label className="label" htmlFor="maxLossNet">
            Perte maximale nette
          </label>
          <input
            id="maxLossNet"
            className="input"
            inputMode="decimal"
            required
            value={maxLossNet}
            onChange={(event) => setMaxLossNet(event.target.value)}
            pattern="^\d+(\.\d{1,8})?$"
          />
        </div>
        <div>
          <label className="label" htmlFor="profitReference">
            Référence de l&apos;objectif
          </label>
          <select
            id="profitReference"
            className="input"
            value={profitReference}
            onChange={(event) =>
              setProfitReference(event.target.value as "session" | "day")
            }
          >
            <option value="session">Session du robot</option>
            <option value="day">Journée de trading (UTC)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="maxTrades">
            Nombre maximal de trades
          </label>
          <input
            id="maxTrades"
            className="input"
            type="number"
            min={1}
            max={1000}
            required
            value={maxTrades}
            onChange={(event) => setMaxTrades(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="maxPositions">
            Positions simultanées max.
          </label>
          <input
            id="maxPositions"
            className="input"
            type="number"
            min={1}
            max={20}
            required
            value={maxPositions}
            onChange={(event) => setMaxPositions(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="maxSpreadPoints">
            Spread maximal (points)
          </label>
          <input
            id="maxSpreadPoints"
            className="input"
            type="number"
            min={0}
            max={10000}
            required
            value={maxSpreadPoints}
            onChange={(event) => setMaxSpreadPoints(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="hoursStart">
            Heure de début (UTC)
          </label>
          <input
            id="hoursStart"
            className="input"
            type="number"
            min={0}
            max={23}
            required
            value={hoursStart}
            onChange={(event) => setHoursStart(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="hoursEnd">
            Heure de fin (UTC)
          </label>
          <input
            id="hoursEnd"
            className="input"
            type="number"
            min={1}
            max={24}
            required
            value={hoursEnd}
            onChange={(event) => setHoursEnd(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="stopPolicy">
            Positions à l&apos;arrêt
          </label>
          <select
            id="stopPolicy"
            className="input"
            value={stopPolicy}
            onChange={(event) =>
              setStopPolicy(event.target.value as "keep_positions" | "close_positions")
            }
          >
            <option value="keep_positions">Conserver les positions</option>
            <option value="close_positions">Fermer les positions</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 p-3">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Paramètres de la stratégie
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(initial.parameterSchema).map(([key, field]) => {
            const id = `param-${key}`;
            const label = field.label ?? key;
            if (field.type === "boolean") {
              return (
                <label key={key} className="flex items-center gap-2 pt-6 text-xs">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border bg-background"
                    checked={Boolean(parameters[key])}
                    onChange={(event) => updateParameter(key, event.target.checked)}
                  />
                  {label}
                </label>
              );
            }
            if (field.type === "enum") {
              return (
                <div key={key}>
                  <label className="label" htmlFor={id}>
                    {label}
                  </label>
                  <select
                    id={id}
                    className="input"
                    value={String(parameters[key] ?? field.default)}
                    onChange={(event) => updateParameter(key, event.target.value)}
                  >
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            const isInteger = field.type === "integer";
            return (
              <div key={key}>
                <label className="label" htmlFor={id}>
                  {label}
                </label>
                <input
                  id={id}
                  className="input"
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={isInteger ? 1 : field.step ?? "any"}
                  value={String(parameters[key] ?? field.default)}
                  onChange={(event) =>
                    updateParameter(
                      key,
                      isInteger ? Number.parseInt(event.target.value, 10) : Number(event.target.value),
                    )
                  }
                />
                <p className="mt-1 text-[10px] text-muted">
                  {field.min} à {field.max}
                  {field.type === "number" && field.step ? ` · pas ${field.step}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-[11px] leading-relaxed text-muted">
        Formule du profit net : réalisé + latent − commissions − swaps. L&apos;objectif déclenche
        le blocage immédiat des nouvelles entrées, l&apos;enregistrement du motif et l&apos;arrêt
        selon la politique choisie. Le slippage, les gaps et les pannes peuvent dépasser la perte
        maximale.
        {initial.live ? (
          <span className="mt-1 block font-medium text-info">
            Robot actif : l&apos;enregistrement enverra une commande de rechargement au moteur.
          </span>
        ) : null}
      </div>

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

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Save className="h-4 w-4" aria-hidden />
        )}
        Enregistrer la configuration
      </button>
    </form>
  );
}
