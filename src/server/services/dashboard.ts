/**
 * Agrégats du tableau de bord (§6 du prompt maître).
 *
 * Les montants proviennent des événements confirmés par le moteur ; les
 * positions ne sont comptées qu'une fois (dernier instantané, non clôturé).
 */

import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  dailyMetrics,
  instances,
  positionsSnapshots,
  robotRuns,
  tradeEvents,
  tradingAccounts,
} from "@/server/db/schema";
import { effectiveState } from "@/server/domain/states";
import { engineStatus } from "./engine";
import { listRobots } from "./robots";

export interface DashboardData {
  account: {
    id: string;
    broker: string;
    server: string;
    loginMasked: string;
    environment: "demo" | "real";
    status: string;
    currency: string;
    balance: string | null;
    equity: string | null;
    marginLevel: string | null;
    lastSnapshotAt: Date | null;
    realApproved: boolean;
  } | null;
  engine: Awaited<ReturnType<typeof engineStatus>>;
  robots: Awaited<ReturnType<typeof listRobots>>;
  activeRobots: number;
  openPositions: Array<{
    instanceId: string | null;
    symbol: string;
    side: "buy" | "sell";
    volume: string;
    openPrice: string;
    currentPrice: string | null;
    profit: string | null;
    observedAt: Date;
  }>;
  dailyPnl: string;
  totalPnl: string;
  lastError: {
    eventType: string;
    result: string | null;
    message: string | null;
    occurredAt: Date;
    robotId: string | null;
  } | null;
  lastRunEnded: {
    id: string;
    stopReason: string | null;
    netResult: string | null;
    endedAt: Date | null;
    robotId: string;
  } | null;
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function dashboardData(userId: string): Promise<DashboardData> {
  const db = getDb();
  const robots = await listRobots(userId);
  const engine = await engineStatus();

  const accountRows = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.ownerUserId, userId))
    .orderBy(desc(tradingAccounts.createdAt))
    .limit(1);
  const account = accountRows[0] ?? null;

  const positionRows = account
    ? await db
        .select()
        .from(positionsSnapshots)
        .where(
          and(
            eq(positionsSnapshots.ownerUserId, userId),
            eq(positionsSnapshots.tradingAccountId, account.id),
            isNull(positionsSnapshots.closeTime),
          ),
        )
        .orderBy(desc(positionsSnapshots.observedAt))
        .limit(200)
    : [];

  const seen = new Set<string>();
  const openPositions = positionRows
    .filter((row) => {
      if (seen.has(row.positionId)) return false;
      seen.add(row.positionId);
      return true;
    })
    .map((row) => ({
      instanceId: row.instanceId,
      symbol: row.symbol,
      side: row.side,
      volume: row.volume,
      openPrice: row.openPrice,
      currentPrice: row.currentPrice,
      profit: row.profit,
      observedAt: row.observedAt,
    }));

  const instanceIds = robots.map((robot) => robot.id);
  const today = startOfUtcDay();

  const totalRows = instanceIds.length
    ? await db
        .select({
          total: sql<string>`coalesce(sum(case when ${tradeEvents.result} ~ '^-?[0-9.]+$' then ${tradeEvents.result}::numeric else 0 end), 0)::text`,
        })
        .from(tradeEvents)
        .where(
          and(
            eq(tradeEvents.ownerUserId, userId),
            eq(tradeEvents.eventType, "position_closed"),
            inArray(tradeEvents.instanceId, instanceIds),
          ),
        )
    : [{ total: "0" }];

  const dailyRows = instanceIds.length
    ? await db
        .select({
          total: sql<string>`coalesce(sum(${dailyMetrics.netPnl}::numeric), 0)::text`,
        })
        .from(dailyMetrics)
        .where(
          and(
            inArray(dailyMetrics.instanceId, instanceIds),
            gte(dailyMetrics.metricDate, today.toISOString().slice(0, 10)),
          ),
        )
    : [{ total: "0" }];

  const errorRows = account
    ? await db
        .select()
        .from(tradeEvents)
        .where(
          and(
            eq(tradeEvents.ownerUserId, userId),
            inArray(tradeEvents.eventType, ["engine_error", "order_rejected", "risk_block"]),
          ),
        )
        .orderBy(desc(tradeEvents.occurredAt))
        .limit(1)
    : [];
  const lastErrorRow = errorRows[0];

  const runRows = instanceIds.length
    ? await db
        .select()
        .from(robotRuns)
        .where(inArray(robotRuns.instanceId, instanceIds))
        .orderBy(desc(robotRuns.startedAt))
        .limit(1)
    : [];
  const run = runRows[0];

  const activeRobots = robots.filter(
    (robot) =>
      ["RUNNING", "STARTING", "STOPPING"].includes(
        effectiveState(robot.state, robot.lastEngineSeenAt),
      ),
  ).length;

  return {
    account: account
      ? {
          id: account.id,
          broker: account.broker,
          server: account.server,
          loginMasked: `${account.login.slice(0, 2)}${"*".repeat(
            Math.max(2, account.login.length - 4),
          )}${account.login.slice(-2)}`,
          environment: account.environment,
          status: account.status,
          currency: account.lastCurrency ?? account.currency,
          balance: account.lastBalance,
          equity: account.lastEquity,
          marginLevel: account.lastMarginLevel,
          lastSnapshotAt: account.lastSnapshotAt,
          realApproved: Boolean(account.realModeApprovedAt),
        }
      : null,
    engine,
    robots,
    activeRobots,
    openPositions,
    dailyPnl: dailyRows[0]?.total ?? "0",
    totalPnl: totalRows[0]?.total ?? "0",
    lastError: lastErrorRow
      ? {
          eventType: lastErrorRow.eventType,
          result: lastErrorRow.result,
          message:
            typeof lastErrorRow.detail === "object" && lastErrorRow.detail
              ? String((lastErrorRow.detail as Record<string, unknown>).message ?? "")
              : null,
          occurredAt: lastErrorRow.occurredAt,
          robotId: lastErrorRow.instanceId,
        }
      : null,
    lastRunEnded: run
      ? {
          id: run.id,
          stopReason: run.stopReason,
          netResult: run.netResult,
          endedAt: run.endedAt,
          robotId: run.instanceId,
        }
      : null,
  };
}

export async function accountSummary(userId: string) {
  const db = getDb();
  const accountRows = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.ownerUserId, userId))
    .orderBy(desc(tradingAccounts.createdAt))
    .limit(1);
  const account = accountRows[0];
  if (!account) return null;
  const robotRows = await db
    .select({ id: instances.id, state: instances.state })
    .from(instances)
    .where(eq(instances.tradingAccountId, account.id));
  return {
    id: account.id,
    broker: account.broker,
    server: account.server,
    currency: account.lastCurrency ?? account.currency,
    balance: account.lastBalance,
    equity: account.lastEquity,
    marginLevel: account.lastMarginLevel,
    lastSnapshotAt: account.lastSnapshotAt,
    status: account.status,
    environment: account.environment,
    robots: robotRows.length,
  };
}
