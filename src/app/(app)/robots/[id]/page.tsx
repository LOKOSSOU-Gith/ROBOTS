import Link from "next/link";
import { ArrowLeft, ScrollText, ShieldCheck } from "lucide-react";

import { RobotActions } from "@/components/robot-actions";
import { StatusBadge, Freshness } from "@/components/status-badge";
import { Badge, Card, CardBody, CardHeader, Notice, Stat } from "@/components/ui";
import { formatAgo, formatDateTime, formatSigned, pnlTone } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { latestPositions } from "@/server/services/accounts";
import { listRuns, listTradeHistory } from "@/server/services/history";
import { getRobot } from "@/server/services/robots";
import { RobotSettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function RobotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const robot = await getRobot(user.id, id);
  const [runs, events, positions] = await Promise.all([
    listRuns(user.id, id, 5),
    listTradeHistory(user.id, { robotId: id, limit: 12 }),
    latestPositions(user.id, robot.accountId),
  ]);
  const robotPositions = positions.filter((position) => position.instanceId === id);
  const live = ["STARTING", "RUNNING", "STOPPING"].includes(robot.reportedState);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/robots" className="btn btn-ghost mb-2 -ml-2 px-2 py-1 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Retour aux robots
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{robot.name}</h1>
            <p className="mt-0.5 text-xs text-muted">
              {robot.strategySlug} · v1.0.0 · {robot.account.broker} ·{" "}
              {robot.account.environment === "real" ? "compte réel" : "compte démo"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge state={robot.state} />
            <span className="text-[11px]">
              <Freshness at={robot.lastEngineSeenAt} />
            </span>
            <Link
              href={`/journaux?robotId=${robot.id}`}
              className="btn btn-outline px-2.5 py-1.5 text-xs"
            >
              <ScrollText className="h-3.5 w-3.5" aria-hidden />
              Journaux
            </Link>
          </div>
        </div>
      </div>

      {robot.reportedState === "RUNNING" && robot.state === "DISCONNECTED" ? (
        <Notice tone="warning" title="Le moteur ne confirme plus l'exécution">
          Dernière confirmation {formatAgo(robot.lastEngineSeenAt)}. L&apos;état RUNNING
          n&apos;est plus affiché, et un redémarrage est bloqué tant que l&apos;état réel
          n&apos;est pas réconcilié.
        </Notice>
      ) : null}

      {robot.newEntriesBlocked ? (
        <Notice tone="warning" title="Nouvelles entrées suspendues">
          Les positions existantes sont conservées. Un arrêt standard ou une liquidation reste
          possible.
        </Notice>
      ) : null}

      <RobotActions
        robotId={robot.id}
        state={robot.state}
        accountConnected={robot.account.status === "connected"}
        startable={["STOPPED", "ERROR", "RISK_HALTED", "DISCONNECTED"].includes(
          robot.reportedState,
        )}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Résultat réalisé"
          value={formatSigned(robot.realizedPnl)}
          tone={pnlTone(robot.realizedPnl)}
          hint="Depuis la création du robot"
        />
        <Stat
          label="Positions ouvertes"
          value={String(robotPositions.length)}
          hint={`${robot.openPositions} confirmée(s)`}
        />
        <Stat
          label="Objectif / perte"
          value={`${robot.profitTargetNet} / -${robot.maxLossNet}`}
          hint={robot.profitReference === "session" ? "Par session" : "Par jour UTC"}
        />
        <Stat
          label="Trades max / spread max"
          value={`${robot.maxTrades} / ${robot.maxSpreadPoints}`}
          hint="Limites propres au robot"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Configuration"
            subtitle="Validation serveur obligatoire, même si le navigateur a déjà validé"
            action={live ? <Badge tone="info">Actif — rechargement à chaud</Badge> : null}
          />
          <CardBody>
            <RobotSettingsForm
              initial={{
                robotId: robot.id,
                symbol: robot.symbol,
                timeframe: robot.timeframe,
                initialLot: robot.initialLot,
                profitTargetNet: robot.profitTargetNet,
                maxLossNet: robot.maxLossNet,
                profitReference: robot.profitReference,
                maxTrades: robot.maxTrades,
                maxPositions: robot.maxPositions,
                maxSpreadPoints: robot.maxSpreadPoints,
                allowedHours: robot.allowedHours,
                stopPolicy: robot.stopPolicy,
                parameters: robot.parameters,
                parameterSchema: robot.parameterSchema,
                supportedSymbols: robot.supportedSymbols,
                live,
              }}
            />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Limites du profil de risque" subtitle="Appliquées dans le moteur" />
            <CardBody>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Perte journalière max.</dt>
                  <dd className="tabular-nums">{robot.risk.maxDailyLoss}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Drawdown max.</dt>
                  <dd className="tabular-nums">{robot.risk.maxDrawdownPct} %</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Positions max.</dt>
                  <dd className="tabular-nums">{robot.risk.maxOpenPositions}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Spread max.</dt>
                  <dd className="tabular-nums">{robot.risk.maxSpreadPoints} pts</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Lot max.</dt>
                  <dd className="tabular-nums">{robot.risk.maxLotSize}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Marge min.</dt>
                  <dd className="tabular-nums">{robot.risk.minMarginLevelPct} %</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Risque / trade</dt>
                  <dd className="tabular-nums">{robot.risk.maxRiskPerTradePct} %</dd>
                </div>
              </dl>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Les contrôles sont exécutés dans le moteur même si le navigateur est fermé.
                L&apos;arrêt sur perte n&apos;est pas garanti au centime près.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Dernières commandes" subtitle="Accusés du moteur" />
            <CardBody className="space-y-2">
              {robot.lastCommands.length === 0 ? (
                <p className="text-xs text-muted">Aucune commande.</p>
              ) : (
                robot.lastCommands.map((command) => (
                  <div key={command.id} className="flex items-start justify-between gap-2 text-[11px]">
                    <div className="min-w-0">
                      <p className="font-medium">{command.type}</p>
                      <p className="truncate text-muted">
                        {command.code ?? command.status}
                        {command.message ? ` · ${command.message}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-muted">
                      {formatDateTime(command.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dernières exécutions" subtitle="Sessions et résultat net" />
          <CardBody className="p-0 sm:p-0">
            {runs.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted">Aucune session.</p>
            ) : (
              <div className="table-wrap">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Début</th>
                      <th>Fin</th>
                      <th className="text-right">Net</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id}>
                        <td className="text-[11px]">{formatDateTime(run.startedAt)}</td>
                        <td className="text-[11px]">{formatDateTime(run.endedAt)}</td>
                        <td className="text-right tabular-nums">{formatSigned(run.netResult)}</td>
                        <td className="text-[11px] text-muted">{run.stopReason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Événements récents" subtitle="Ordres, positions, risques" />
          <CardBody className="space-y-2">
            {events.length === 0 ? (
              <p className="text-xs text-muted">Aucun événement.</p>
            ) : (
              events.map((event) => (
                <div key={event.id} className="flex items-start justify-between gap-2 text-[11px]">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {event.label}
                      {event.symbol ? ` · ${event.symbol}` : ""}
                    </p>
                    <p className="truncate text-muted">
                      {[event.volume ? `${event.volume} lot` : null, event.result, event.retcode]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <span className="shrink-0 text-muted">{formatDateTime(event.occurredAt)}</span>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      {robotPositions.length > 0 ? (
        <Card>
          <CardHeader title="Positions de ce robot" subtitle="Dernier instantané confirmé" />
          <CardBody className="p-0 sm:p-0">
            <div className="table-wrap">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Symbole</th>
                    <th>Sens</th>
                    <th>Volume</th>
                    <th>Entrée</th>
                    <th>Actuel</th>
                    <th className="text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {robotPositions.map((position) => (
                    <tr key={position.positionId}>
                      <td className="font-medium">{position.symbol}</td>
                      <td>{position.side === "buy" ? "Achat" : "Vente"}</td>
                      <td className="tabular-nums">{position.volume}</td>
                      <td className="tabular-nums">{position.openPrice}</td>
                      <td className="tabular-nums">{position.currentPrice ?? "—"}</td>
                      <td className="text-right tabular-nums">{formatSigned(position.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
