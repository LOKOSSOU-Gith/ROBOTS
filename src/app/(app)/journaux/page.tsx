import Link from "next/link";
import { Filter } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { listLogs, listRuns } from "@/server/services/history";
import { listRobots } from "@/server/services/robots";
import { EmergencyStopPanel } from "./emergency-stop";

export const dynamic = "force-dynamic";

const KIND_TONE = {
  commande: "info",
  risque: "warning",
  erreur: "danger",
  audit: "neutral",
  connexion: "success",
} as const;

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ robotId?: string }>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const robotId = params.robotId || undefined;
  const [logs, robots, runs] = await Promise.all([
    listLogs(user.id, robotId),
    listRobots(user.id),
    listRuns(user.id, robotId, 8),
  ]);

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={15} />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Journaux et surveillance</h1>
        <p className="mt-0.5 text-xs text-muted">
          Démarrages, arrêts, erreurs broker, objectifs atteints, déconnexions et actions
          administratives. Aucun secret n&apos;est journalisé.
        </p>
      </div>

      <EmergencyStopPanel />

      <Card>
        <CardHeader
          title="Filtrer"
          subtitle="Par robot, pour isoler une exécution"
          action={
            <form method="GET" className="flex items-center gap-2">
              <select
                name="robotId"
                className="input px-2 py-1 text-xs"
                defaultValue={params.robotId ?? ""}
                aria-label="Filtrer par robot"
              >
                <option value="">Tous</option>
                {robots.map((robot) => (
                  <option key={robot.id} value={robot.id}>
                    {robot.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-outline px-2 py-1 text-xs">
                <Filter className="h-3 w-3" aria-hidden />
                Filtrer
              </button>
            </form>
          }
        />
        <CardBody className="p-0 sm:p-0">
          {logs.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                title="Aucun journal"
                description="Les commandes et événements du moteur apparaîtront ici dès la première exécution."
              />
            </div>
          ) : (
            <ul className="divide-y">
              {logs.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5 text-xs sm:px-5">
                  <span className="w-[150px] shrink-0 text-[11px] tabular-nums text-muted">
                    {formatDateTime(entry.at)}
                  </span>
                  <Badge tone={KIND_TONE[entry.kind]}>{entry.kind}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{entry.title}</p>
                    {entry.detail ? (
                      <p className="mt-0.5 break-words text-[11px] text-muted">{entry.detail}</p>
                    ) : null}
                  </div>
                  {entry.robotId ? (
                    <Link
                      href={`/robots/${entry.robotId}`}
                      className="text-[11px] text-primary underline-offset-2 hover:underline"
                    >
                      Voir le robot
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sessions récentes" subtitle="Motif d'arrêt et résultat net" />
        <CardBody className="p-0 sm:p-0">
          {runs.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted">Aucune session.</p>
          ) : (
            <div className="table-wrap">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Robot</th>
                    <th>Début</th>
                    <th>Fin</th>
                    <th>Trades</th>
                    <th className="text-right">Net</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td className="text-[11px]">{run.robotName}</td>
                      <td className="whitespace-nowrap text-[11px]">
                        {formatDateTime(run.startedAt)}
                      </td>
                      <td className="whitespace-nowrap text-[11px]">
                        {formatDateTime(run.endedAt)}
                      </td>
                      <td className="tabular-nums">{run.tradesCount}</td>
                      <td className="text-right tabular-nums">{run.netResult ?? "—"}</td>
                      <td className="text-[11px] text-muted">{run.stopReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
