/**
 * Historique et journaux (§6 du prompt maître).
 *
 * Les ordres, deals et positions sont distingués par `event_type` pour ne pas
 * compter deux fois le même gain : seul `position_closed` porte un résultat
 * réalisé.
 */

import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  auditEvents,
  commandAcks,
  commands,
  dailyMetrics,
  instances,
  robotRuns,
  strategies,
  strategyVersions,
  tradeEvents,
} from "@/server/db/schema";
import { notFound } from "@/server/http/api";

export interface HistoryFilters {
  robotId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export const EVENT_LABELS: Record<string, string> = {
  order_sent: "Ordre envoyé",
  order_accepted: "Ordre accepté",
  order_rejected: "Ordre rejeté",
  position_opened: "Position ouverte",
  position_modified: "Position modifiée",
  position_closed: "Position clôturée",
  deal: "Transaction",
  reconnect: "Reconnexion",
  risk_block: "Blocage risque",
  engine_error: "Erreur moteur",
};

export const EVENT_KIND: Record<string, "ordre" | "deal" | "position" | "système"> = {
  order_sent: "ordre",
  order_accepted: "ordre",
  order_rejected: "ordre",
  position_opened: "position",
  position_modified: "position",
  position_closed: "position",
  deal: "deal",
  reconnect: "système",
  risk_block: "système",
  engine_error: "système",
};

export async function listTradeHistory(userId: string, filters: HistoryFilters = {}) {
  const db = getDb();
  const conditions = [eq(tradeEvents.ownerUserId, userId)];
  if (filters.robotId) conditions.push(eq(tradeEvents.instanceId, filters.robotId));
  if (filters.from) conditions.push(gte(tradeEvents.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(tradeEvents.occurredAt, filters.to));

  const rows = await db
    .select({
      event: tradeEvents,
      strategyName: strategies.name,
    })
    .from(tradeEvents)
    .leftJoin(instances, eq(instances.id, tradeEvents.instanceId))
    .leftJoin(strategyVersions, eq(strategyVersions.id, instances.strategyVersionId))
    .leftJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
    .where(and(...conditions))
    .orderBy(desc(tradeEvents.occurredAt))
    .limit(Math.min(filters.limit ?? 200, 500));

  return rows.map((row) => ({
    id: row.event.id,
    occurredAt: row.event.occurredAt,
    robotId: row.event.instanceId,
    robotName: row.strategyName ?? "—",
    type: row.event.eventType,
    kind: EVENT_KIND[row.event.eventType] ?? "système",
    label: EVENT_LABELS[row.event.eventType] ?? row.event.eventType,
    symbol: row.event.symbol,
    volume: row.event.volume,
    price: row.event.price,
    result: row.event.result,
    retcode: row.event.retcode,
    ticket: row.event.brokerTicket,
    detail: row.event.detail as Record<string, unknown>,
  }));
}

export async function listRuns(userId: string, robotId?: string, limit = 100) {
  const db = getDb();
  const conditions = [eq(instances.ownerUserId, userId)];
  if (robotId) conditions.push(eq(robotRuns.instanceId, robotId));
  return db
    .select({
      id: robotRuns.id,
      robotId: robotRuns.instanceId,
      robotName: strategies.name,
      startedAt: robotRuns.startedAt,
      endedAt: robotRuns.endedAt,
      startEquity: robotRuns.startEquity,
      endEquity: robotRuns.endEquity,
      netResult: robotRuns.netResult,
      tradesCount: robotRuns.tradesCount,
      stopReason: robotRuns.stopReason,
    })
    .from(robotRuns)
    .innerJoin(instances, eq(instances.id, robotRuns.instanceId))
    .innerJoin(strategyVersions, eq(strategyVersions.id, instances.strategyVersionId))
    .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
    .where(and(...conditions))
    .orderBy(desc(robotRuns.startedAt))
    .limit(limit);
}

export interface LogEntry {
  id: string;
  at: Date;
  kind: "commande" | "risque" | "erreur" | "audit" | "connexion";
  title: string;
  detail: string;
  robotId: string | null;
}

export async function listLogs(userId: string, robotId?: string, limit = 150): Promise<LogEntry[]> {
  const db = getDb();
  const entries: LogEntry[] = [];

  const eventConditions = [
    eq(tradeEvents.ownerUserId, userId),
    inArray(tradeEvents.eventType, ["engine_error", "order_rejected", "risk_block", "reconnect"]),
  ];
  if (robotId) eventConditions.push(eq(tradeEvents.instanceId, robotId));
  const events = await db
    .select()
    .from(tradeEvents)
    .where(and(...eventConditions))
    .orderBy(desc(tradeEvents.occurredAt))
    .limit(limit);

  for (const event of events) {
    const detail = (event.detail ?? {}) as Record<string, unknown>;
    entries.push({
      id: event.id,
      at: event.occurredAt,
      kind:
        event.eventType === "engine_error"
          ? "erreur"
          : event.eventType === "risk_block"
            ? "risque"
            : "connexion",
      title: EVENT_LABELS[event.eventType] ?? event.eventType,
      detail: [event.result, event.retcode, detail.message, detail.reason]
        .filter(Boolean)
        .join(" · "),
      robotId: event.instanceId,
    });
  }

  const commandConditions = [eq(commands.requestedBy, userId)];
  if (robotId) commandConditions.push(eq(commands.instanceId, robotId));
  const acks = await db
    .select({
      ack: commandAcks,
      type: commands.type,
      instanceId: commands.instanceId,
    })
    .from(commandAcks)
    .innerJoin(commands, eq(commands.id, commandAcks.commandId))
    .where(and(...commandConditions))
    .orderBy(desc(commandAcks.reportedAt))
    .limit(limit);

  for (const row of acks) {
    entries.push({
      id: row.ack.id,
      at: row.ack.reportedAt,
      kind: "commande",
      title: `Commande ${row.type} — ${row.ack.ack}`,
      detail: [row.ack.code, row.ack.message].filter(Boolean).join(" · "),
      robotId: row.instanceId,
    });
  }

  const audits = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.actorUserId, userId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
  for (const audit of audits) {
    entries.push({
      id: audit.id,
      at: audit.createdAt,
      kind: "audit",
      title: audit.action,
      detail: audit.result,
      robotId: audit.targetType === "instance" ? audit.targetId : null,
    });
  }

  return entries
    .filter((entry) => (robotId ? entry.robotId === robotId : true))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

export async function robotDailyMetrics(userId: string, robotId: string) {
  const db = getDb();
  const owned = await db
    .select({ id: instances.id })
    .from(instances)
    .where(and(eq(instances.id, robotId), eq(instances.ownerUserId, userId)))
    .limit(1);
  if (!owned[0]) throw notFound("Robot introuvable");
  const rows = await db
    .select()
    .from(dailyMetrics)
    .where(eq(dailyMetrics.instanceId, robotId))
    .orderBy(desc(dailyMetrics.metricDate))
    .limit(60);
  const totals = await db
    .select({
      net: sql<string>`coalesce(sum(${dailyMetrics.netPnl}::numeric), 0)::text`,
      trades: sql<number>`coalesce(sum(${dailyMetrics.tradesCount}), 0)::int`,
    })
    .from(dailyMetrics)
    .where(eq(dailyMetrics.instanceId, robotId));
  return { metrics: rows, total: totals[0] ?? { net: "0", trades: 0 } };
}
