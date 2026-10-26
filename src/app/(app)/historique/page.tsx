import Link from "next/link";
import { Download, Filter } from "lucide-react";

import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { formatDateTime, formatSigned, pnlTone } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { listRuns, listTradeHistory, type HistoryFilters } from "@/server/services/history";
import { listRobots } from "@/server/services/robots";

export const dynamic = "force-dynamic";

function parseFrom(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseTo(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const KIND_TONE = {
  ordre: "info",
  deal: "warning",
  position: "success",
  système: "neutral",
} as const;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ robotId?: string; from?: string; to?: string }>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const robots = await listRobots(user.id);
  const filters: HistoryFilters = {
    robotId: params.robotId || undefined,
    from: parseFrom(params.from),
    to: parseTo(params.to),
    limit: 300,
  };
  const [trades, runs] = await Promise.all([
    listTradeHistory(user.id, filters),
    listRuns(user.id, filters.robotId, 20),
  ]);

  const realized = trades
    .filter((trade) => trade.kind === "position" && trade.type === "position_closed")
    .reduce((total, trade) => {
      const value = Number(trade.result);
      return Number.isFinite(value) ? total + value : total;
    }, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Historique</h1>
          <p className="mt-0.5 text-xs text-muted">
            Ordres, deals et positions sont distingués : seul un closing de position porte un
            résultat réalisé, sans double comptage.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted">Réalisé sur la période</p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              pnlTone(String(realized)) === "success"
                ? "text-success"
                : pnlTone(String(realized)) === "danger"
                  ? "text-destructive"
                  : ""
            }`}
          >
            {formatSigned(String(realized))}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader title="Filtres" subtitle="Robot et période (UTC)" />
        <CardBody>
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]">
              <label className="label" htmlFor="robotId">
                Robot
              </label>
              <select id="robotId" name="robotId" className="input" defaultValue={params.robotId ?? ""}>
                <option value="">Tous les robots</option>
                {robots.map((robot) => (
                  <option key={robot.id} value={robot.id}>
                    {robot.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="from">
                Du
              </label>
              <input id="from" name="from" type="date" className="input" defaultValue={params.from ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="to">
                Au
              </label>
              <input id="to" name="to" type="date" className="input" defaultValue={params.to ?? ""} />
            </div>
            <button type="submit" className="btn btn-outline">
              <Filter className="h-3.5 w-3.5" aria-hidden />
              Filtrer
            </button>
            <Link href="/historique" className="btn btn-ghost">
              Réinitialiser
            </Link>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Opérations"
          subtitle={`${trades.length} événement(s) · commissions et swaps dans le détail`}
          action={
            <Link
              href={`/api/v1/trades${params.robotId ? `?robotId=${params.robotId}` : ""}`}
              className="btn btn-ghost px-2 py-1 text-xs"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              API JSON
            </Link>
          }
        />
        <CardBody className="p-0 sm:p-0">
          {trades.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                title="Aucune opération sur cette période"
                description="Les événements apparaîtront après le premier démarrage confirmé d'un robot et les premiers ordres du moteur."
              />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Robot</th>
                    <th>Type</th>
                    <th>Symbole</th>
                    <th>Volume</th>
                    <th>Prix</th>
                    <th className="text-right">Résultat</th>
                    <th>Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={trade.id}>
                      <td className="whitespace-nowrap text-[11px] text-muted">
                        {formatDateTime(trade.occurredAt)}
                      </td>
                      <td className="text-[11px]">{trade.robotName}</td>
                      <td>
                        <div className="flex flex-col gap-1">
                          <Badge tone={KIND_TONE[trade.kind]}>{trade.kind}</Badge>
                          <span className="text-[10px] text-muted">{trade.label}</span>
                        </div>
                      </td>
                      <td className="font-medium">{trade.symbol ?? "—"}</td>
                      <td className="tabular-nums">{trade.volume ?? "—"}</td>
                      <td className="tabular-nums">{trade.price ?? "—"}</td>
                      <td
                        className={`text-right tabular-nums ${
                          pnlTone(trade.result) === "success"
                            ? "text-success"
                            : pnlTone(trade.result) === "danger"
                              ? "text-destructive"
                              : ""
                        }`}
                      >
                        {trade.result ?? "—"}
                      </td>
                      <td className="text-[11px] text-muted">{trade.ticket ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sessions de robots" subtitle="Motif d'arrêt et résultat net" />
        <CardBody className="p-0 sm:p-0">
          {runs.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted">Aucune session enregistrée.</p>
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
                    <th>Motif d&apos;arrêt</th>
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
    </div>
  );
}
