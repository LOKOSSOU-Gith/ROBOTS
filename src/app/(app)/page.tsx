import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleDollarSign,
  PlugZap,
  WifiOff,
} from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { Freshness, StatusBadge } from "@/components/status-badge";
import { Badge, Card, CardBody, CardHeader, EmptyState, Notice, Stat } from "@/components/ui";
import { formatAgo, formatDateTime, formatMoney, formatSigned, pnlTone } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { dashboardData } from "@/server/services/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requirePageUser();
  const data = await dashboardData(user.id);
  const currency = data.account?.currency ?? "USD";
  const robotName = (id: string | null) =>
    data.robots.find((robot) => robot.id === id)?.name ?? "—";

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tableau de bord</h1>
          <p className="mt-0.5 text-xs text-muted">
            État confirmé par le moteur · actualisation automatique toutes les 15 s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={data.engine.online ? "success" : "warning"}>
            {data.engine.online ? (
              <Activity className="h-3 w-3" aria-hidden />
            ) : (
              <WifiOff className="h-3 w-3" aria-hidden />
            )}
            Moteur {data.engine.online ? "en ligne" : "silencieux"}
          </Badge>
          {data.account ? (
            <Badge tone={data.account.environment === "real" ? "danger" : "info"}>
              {data.account.environment === "real" ? "Compte réel" : "Compte démo"}
            </Badge>
          ) : null}
        </div>
      </div>

      {!data.engine.online ? (
        <Notice tone="warning" title="Le moteur MT5 ne répond pas">
          Les robots ne peuvent ni démarrer ni être confirmés tant que le service moteur
          n&apos;envoie pas de heartbeat. Dernier signe de vie :{" "}
          {formatAgo(data.engine.lastSeenAt)}.
        </Notice>
      ) : null}

      {!data.account ? (
        <Card>
          <CardBody>
            <EmptyState
              title="Aucun compte MT5 enregistré"
              description="Renseignez le serveur, le numéro de compte et le mot de passe de trading. Les quatre robots seront créés automatiquement, en mode démo par défaut."
              action={
                <Link href="/compte" className="btn btn-primary mt-2">
                  <PlugZap className="h-4 w-4" aria-hidden />
                  Configurer la connexion MT5
                </Link>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Solde"
              value={formatMoney(data.account.balance, currency)}
              hint={`${data.account.broker} · ${data.account.server}`}
            />
            <Stat
              label="Équité"
              value={formatMoney(data.account.equity, currency)}
              hint={`Marge ${data.account.marginLevel ?? "—"} %`}
            />
            <Stat
              label="Résultat du jour"
              value={formatSigned(data.dailyPnl, currency)}
              tone={pnlTone(data.dailyPnl)}
              hint="Net, commissions et swaps déduits"
            />
            <Stat
              label="Résultat global"
              value={formatSigned(data.totalPnl, currency)}
              tone={pnlTone(data.totalPnl)}
              hint={`${data.activeRobots} robot(s) actif(s) sur ${data.robots.length}`}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader
                title="Compte connecté"
                subtitle={`Identifiant ${data.account.loginMasked} · dernière donnée ${formatAgo(data.account.lastSnapshotAt)}`}
                action={
                  <Badge
                    tone={
                      data.account.status === "connected"
                        ? "success"
                        : data.account.status === "error"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {data.account.status === "connected"
                      ? "Connexion testée"
                      : data.account.status === "error"
                        ? "Erreur de connexion"
                        : "Non testé"}
                  </Badge>
                }
              />
              <CardBody className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted">Broker</p>
                  <p className="text-sm">{data.account.broker}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted">Serveur</p>
                  <p className="text-sm">{data.account.server}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted">Positions ouvertes</p>
                  <p className="text-sm tabular-nums">{data.openPositions.length}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted">Mode réel</p>
                  <p className="text-sm">
                    {data.account.realApproved ? "Autorisé explicitement" : "Non autorisé"}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <Link href="/compte" className="btn btn-outline mt-1">
                    Gérer la connexion
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Robots"
                subtitle="État confirmé, jamais optimiste"
                action={
                  <Link href="/robots" className="btn btn-ghost px-2 py-1 text-xs">
                    Tout voir
                  </Link>
                }
              />
              <CardBody className="space-y-2">
                {data.robots.length === 0 ? (
                  <p className="text-xs text-muted">Aucun robot configuré.</p>
                ) : (
                  data.robots.map((robot) => (
                    <Link
                      key={robot.id}
                      href={`/robots/${robot.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 transition hover:bg-white/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{robot.name}</p>
                        <p className="text-[11px] text-muted">
                          {robot.symbol} · {robot.timeframe} · {robot.initialLot} lot
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge state={robot.state} />
                        <span className="text-[10px] text-muted">
                          {formatAgo(robot.lastEngineSeenAt)}
                        </span>
                      </div>
                    </Link>
                  ))
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Positions ouvertes"
              subtitle="Dernier instantané transmis par le moteur"
              action={<Badge>{data.openPositions.length}</Badge>}
            />
            <CardBody className="p-0 sm:p-0">
              {data.openPositions.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-muted sm:px-5">
                  Aucune position ouverte confirmée.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Robot</th>
                        <th>Symbole</th>
                        <th>Sens</th>
                        <th>Volume</th>
                        <th>Entrée</th>
                        <th>Actuel</th>
                        <th className="text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.openPositions.map((position, index) => (
                        <tr key={`${position.symbol}-${index}`}>
                          <td className="text-xs">{robotName(position.instanceId)}</td>
                          <td className="font-medium">{position.symbol}</td>
                          <td>
                            <Badge tone={position.side === "buy" ? "success" : "danger"}>
                              {position.side === "buy" ? "Achat" : "Vente"}
                            </Badge>
                          </td>
                          <td className="tabular-nums">{position.volume}</td>
                          <td className="tabular-nums">{position.openPrice}</td>
                          <td className="tabular-nums">{position.currentPrice ?? "—"}</td>
                          <td
                            className={`text-right tabular-nums ${
                              pnlTone(position.profit) === "success"
                                ? "text-success"
                                : pnlTone(position.profit) === "danger"
                                  ? "text-destructive"
                                  : ""
                            }`}
                          >
                            {formatSigned(position.profit, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Dernière alerte" subtitle="Erreur, rejet ou blocage de risque" />
              <CardBody>
                {data.lastError ? (
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">
                        {data.lastError.eventType} · {robotName(data.lastError.robotId)}
                      </p>
                      <p className="mt-1 break-words text-xs text-muted">
                        {data.lastError.message || data.lastError.result || "Sans détail"}
                      </p>
                      <p className="mt-1 text-[11px] text-muted">
                        {formatDateTime(data.lastError.occurredAt)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted">Aucune alerte enregistrée.</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Dernière exécution" subtitle="Résultat net de la session" />
              <CardBody>
                {data.lastRunEnded ? (
                  <div className="space-y-1.5 text-xs">
                    <p className="font-medium">
                      {robotName(data.lastRunEnded.robotId)} ·{" "}
                      {formatSigned(data.lastRunEnded.netResult, currency)}
                    </p>
                    <p className="text-muted">
                      Arrêt : {data.lastRunEnded.stopReason ?? "non renseigné"}
                    </p>
                    <p className="text-muted">{formatDateTime(data.lastRunEnded.endedAt)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted">Aucune exécution terminée pour l&apos;instant.</p>
                )}
              </CardBody>
            </Card>
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <Bot className="h-3.5 w-3.5" aria-hidden />
            <CircleDollarSign className="h-3.5 w-3.5" aria-hidden />
            Le profit net affiché déduit commissions et swaps ; les positions ne sont comptées
            qu&apos;une fois.
          </p>
        </>
      )}
    </div>
  );
}
