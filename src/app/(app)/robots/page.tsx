import Link from "next/link";
import { ArrowRight, ScrollText, Settings2 } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { RobotActions } from "@/components/robot-actions";
import { StatusBadge } from "@/components/status-badge";
import { Badge, Card, CardBody, EmptyState, Notice } from "@/components/ui";
import { formatAgo, formatSigned, pnlTone } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { listAccounts } from "@/server/services/accounts";
import { listRobots } from "@/server/services/robots";

export const dynamic = "force-dynamic";

export default async function RobotsPage() {
  const user = await requirePageUser();
  const [robots, accounts] = await Promise.all([listRobots(user.id), listAccounts(user.id)]);
  const account = accounts[0];
  const accountConnected = account?.status === "connected";

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={10} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Robots</h1>
          <p className="mt-0.5 text-xs text-muted">
            Quatre gabarits configurables. Aucune rentabilité n&apos;est garantie ; le mode réel
            exige une autorisation explicite.
          </p>
        </div>
        {account ? (
          <Badge tone={accountConnected ? "success" : "warning"}>
            {accountConnected ? "Connexion MT5 testée" : "Connexion MT5 non testée"}
          </Badge>
        ) : null}
      </div>

      {!account ? (
        <Card>
          <CardBody>
            <EmptyState
              title="Aucun compte MT5"
              description="Les robots sont rattachés à un compte de trading. Enregistrez d'abord votre compte démo."
              action={
                <Link href="/compte" className="btn btn-primary mt-2">
                  Configurer le compte
                </Link>
              }
            />
          </CardBody>
        </Card>
      ) : !accountConnected ? (
        <Notice tone="warning" title="Test de connexion requis">
          Le moteur refuse de démarrer un robot tant que la connexion au compte n&apos;a pas été
          testée avec succès.{" "}
          <Link href="/compte" className="underline">
            Tester la connexion
          </Link>
          .
        </Notice>
      ) : null}

      {robots.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="Aucun robot enregistré"
              description="Les quatre robots sont créés automatiquement à l'enregistrement d'un compte MT5."
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {robots.map((robot) => (
            <Card key={robot.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{robot.name}</h2>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {robot.strategySlug} · v1.0.0 ·{" "}
                    {robot.accountEnvironment === "real" ? "réel" : "démo"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge state={robot.state} />
                  {robot.newEntriesBlocked ? <Badge tone="warning">Entrées bloquées</Badge> : null}
                </div>
              </div>

              <CardBody className="flex-1 space-y-3">
                <p className="line-clamp-2 text-xs leading-relaxed text-muted">
                  {robot.description}
                </p>

                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted">Symbole</dt>
                    <dd className="font-medium">{robot.symbol}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted">Timeframe</dt>
                    <dd className="font-medium">{robot.timeframe}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted">Lot initial</dt>
                    <dd className="font-medium tabular-nums">{robot.initialLot}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted">Positions</dt>
                    <dd className="font-medium tabular-nums">{robot.openPositions}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted">Objectif / perte</dt>
                    <dd className="font-medium tabular-nums">
                      {robot.profitTargetNet} / -{robot.maxLossNet}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted">Résultat réalisé</dt>
                    <dd
                      className={`font-medium tabular-nums ${
                        pnlTone(robot.realizedPnl) === "success"
                          ? "text-success"
                          : pnlTone(robot.realizedPnl) === "danger"
                            ? "text-destructive"
                            : ""
                      }`}
                    >
                      {formatSigned(robot.realizedPnl)}
                    </dd>
                  </div>
                </dl>

                {robot.stopReason ? (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
                    Dernier arrêt : {robot.stopReason}
                  </p>
                ) : null}

                <RobotActions
                  robotId={robot.id}
                  state={robot.state}
                  accountConnected={accountConnected}
                  startable={["STOPPED", "ERROR", "RISK_HALTED", "DISCONNECTED"].includes(
                    robot.reportedState,
                  )}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted">
                  <span>Activité {formatAgo(robot.lastActivityAt)}</span>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/historique?robotId=${robot.id}`}
                      className="btn btn-ghost px-2 py-1 text-[11px]"
                    >
                      <ScrollText className="h-3 w-3" aria-hidden />
                      Journaux
                    </Link>
                    <Link
                      href={`/robots/${robot.id}`}
                      className="btn btn-outline px-2 py-1 text-[11px]"
                    >
                      <Settings2 className="h-3 w-3" aria-hidden />
                      Configurer
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </Link>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
