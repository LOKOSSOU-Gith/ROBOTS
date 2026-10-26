/**
 * Protocole backend ↔ moteur (§8.1).
 *
 * Le moteur initie toutes les connexions. Chaque commande est persistée avec
 * une expiration et une clé d'idempotence ; les accusés sont distincts
 * (reçue, acceptée, démarrée, terminée) et l'état confirmé vient uniquement du
 * moteur.
 */

import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  commandAcks,
  commands,
  connectionTests,
  dailyMetrics,
  engineHeartbeats,
  instances,
  positionsSnapshots,
  riskProfiles,
  robotRuns,
  robotSettings,
  strategies,
  strategyVersions,
  tradeEvents,
  tradingAccounts,
} from "@/server/db/schema";
import { INSTANCE_STATES, parseState, type InstanceState } from "@/server/domain/states";
import { ApiError, badRequest, notFound } from "@/server/http/api";
import { revealAccountSecret } from "./accounts";
import { recordAudit } from "./audit";

const ENGINE_SILENCE_MS = 45_000;
const COMMAND_ACKS = ["received", "accepted", "started", "completed", "failed", "rejected"] as const;
type Ack = (typeof COMMAND_ACKS)[number];

export interface RuntimePayload {
  instance_id: string;
  owner_user_id: string;
  mode: string;
  symbols: string[];
  parameters: Record<string, unknown>;
  artifact_digest: string | null;
  magic_number: number | null;
  runnable: boolean;
  reason?: string;
  account: {
    id: string;
    broker: string;
    server: string;
    login: string;
    environment: "demo" | "real";
    status: string;
    real_authorized: boolean;
  };
  strategy: {
    slug: string;
    version: string;
    parameter_schema: Record<string, unknown>;
    supported_symbols: string[];
    symbol_aliases: Record<string, unknown>;
    risk_constraints: Record<string, unknown>;
    martingale_allowed: boolean;
    artifact_digest: string;
    status: string;
  };
  risk: Record<string, unknown>;
  objective: {
    profit_target_net: string;
    max_loss_net: string;
    reference: "session" | "day";
    stop_policy: "keep_positions" | "close_positions";
    max_trades: number;
  };
  settings: {
    symbol: string;
    timeframe: string;
    initial_lot: string;
    max_positions: number;
    max_spread_points: number;
    allowed_hours: { start: number; end: number };
  };
}

export async function getRuntime(instanceId: string): Promise<RuntimePayload> {
  const db = getDb();
  const rows = await db
    .select({
      instance: instances,
      account: tradingAccounts,
      settings: robotSettings,
      risk: riskProfiles,
      version: strategyVersions,
      strategySlug: strategies.slug,
    })
    .from(instances)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, instances.tradingAccountId))
    .innerJoin(strategyVersions, eq(strategyVersions.id, instances.strategyVersionId))
    .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
    .innerJoin(riskProfiles, eq(riskProfiles.id, instances.riskProfileId))
    .leftJoin(robotSettings, eq(robotSettings.instanceId, instances.id))
    .where(eq(instances.id, instanceId))
    .limit(1);

  const row = rows[0];
  if (!row) throw notFound("Instance introuvable");

  const problems: string[] = [];
  if (!row.settings) problems.push("settings_missing");
  if (row.version.martingaleAllowed) problems.push("martingale_forbidden");
  if (row.version.status === "deprecated") problems.push("strategy_deprecated");
  if (row.account.status !== "connected") problems.push("account_not_tested");
  if (row.account.environment === "real") {
    if (!row.account.realModeApprovedAt || !row.instance.realAuthorizedAt) {
      problems.push("real_mode_not_approved");
    }
  }

  const settings = row.settings;
  const risk = row.risk;

  return {
    instance_id: row.instance.id,
    owner_user_id: row.instance.ownerUserId,
    mode: row.instance.mode,
    symbols: (row.instance.symbols as string[]) ?? [],
    parameters: (row.instance.parameters as Record<string, unknown>) ?? {},
    artifact_digest: row.instance.artifactDigest,
    magic_number: row.instance.magicNumber,
    runnable: problems.length === 0,
    ...(problems.length ? { reason: problems.join(",") } : {}),
    account: {
      id: row.account.id,
      broker: row.account.broker,
      server: row.account.server,
      login: row.account.login,
      environment: row.account.environment,
      status: row.account.status,
      real_authorized: Boolean(row.account.realModeApprovedAt && row.instance.realAuthorizedAt),
    },
    strategy: {
      slug: row.strategySlug,
      version: row.version.version,
      parameter_schema: row.version.parameterSchema as Record<string, unknown>,
      supported_symbols: row.version.supportedSymbols as string[],
      symbol_aliases: row.version.symbolAliases as Record<string, unknown>,
      risk_constraints: row.version.riskConstraints as Record<string, unknown>,
      martingale_allowed: row.version.martingaleAllowed,
      artifact_digest: row.version.artifactDigest,
      status: row.version.status,
    },
    risk: {
      max_daily_loss: risk.maxDailyLoss,
      max_drawdown_pct: risk.maxDrawdownPct,
      max_open_positions: Math.min(risk.maxOpenPositions, settings?.maxPositions ?? 1),
      max_total_exposure: risk.maxTotalExposure,
      max_spread_points: Math.min(risk.maxSpreadPoints, settings?.maxSpreadPoints ?? 0),
      min_margin_level_pct: risk.minMarginLevelPct,
      max_risk_per_trade_pct: risk.maxRiskPerTradePct,
      max_lot_size: risk.maxLotSize,
      forbid_lot_increase_after_loss: risk.forbidLotIncreaseAfterLoss,
    },
    objective: {
      profit_target_net: settings?.profitTargetNet ?? "0",
      max_loss_net: settings?.maxLossNet ?? "0",
      reference: settings?.profitReference ?? "session",
      stop_policy: settings?.stopPolicy ?? "keep_positions",
      max_trades: settings?.maxTrades ?? 0,
    },
    settings: {
      symbol: settings?.symbol ?? "XAUUSD",
      timeframe: settings?.timeframe ?? "M15",
      initial_lot: settings?.initialLot ?? "0.01",
      max_positions: settings?.maxPositions ?? 1,
      max_spread_points: settings?.maxSpreadPoints ?? 0,
      allowed_hours: (settings?.allowedHours as { start: number; end: number }) ?? {
        start: 0,
        end: 24,
      },
    },
  };
}

export async function pendingCommand(engineId: string) {
  const db = getDb();
  const now = new Date();

  await db
    .update(commands)
    .set({ status: "expired", updatedAt: now })
    .where(and(inArray(commands.status, ["requested"]), lt(commands.expiresAt, now)));

  // Un moteur tombé après réception n'a pas acquitté : la commande est
  // redistribuée tant qu'elle n'a pas expiré (idempotence côté moteur).
  await db
    .update(commands)
    .set({ status: "requested", updatedAt: now })
    .where(
      and(
        eq(commands.status, "received"),
        lt(commands.receivedAt, new Date(now.getTime() - 20_000)),
        lt(commands.attempts, 3),
        sql`${commands.expiresAt} > now()`,
      ),
    );

  const rows = await db
    .select()
    .from(commands)
    .where(and(eq(commands.status, "requested"), sql`${commands.expiresAt} > now()`))
    .orderBy(asc(commands.createdAt))
    .limit(1);

  const command = rows[0];
  if (!command) return { command: null };

  const updated = await db
    .update(commands)
    .set({
      status: "received",
      engineId,
      receivedAt: now,
      attempts: command.attempts + 1,
      updatedAt: now,
    })
    .where(and(eq(commands.id, command.id), eq(commands.status, "requested")))
    .returning();

  const claimed = updated[0];
  if (!claimed) return { command: null };

  return {
    command: {
      id: claimed.id,
      instance_id: claimed.instanceId,
      type: claimed.type,
      payload: claimed.payload,
      expires_at: claimed.expiresAt.toISOString(),
      attempt: claimed.attempts,
    },
  };
}

export interface AckInput {
  commandId: string;
  ack: string;
  code?: string;
  message?: string;
  observedState?: string;
  detail?: Record<string, unknown>;
}

export async function acknowledgeCommand(engineId: string, input: AckInput) {
  if (!(COMMAND_ACKS as readonly string[]).includes(input.ack)) {
    throw badRequest("Accusé inconnu");
  }
  const ack = input.ack as Ack;
  const db = getDb();
  const rows = await db.select().from(commands).where(eq(commands.id, input.commandId)).limit(1);
  const command = rows[0];
  if (!command) throw notFound("Commande introuvable");
  if (command.engineId && command.engineId !== engineId) {
    throw new ApiError(409, "command_owned_by_other_engine", "Commande attribuée à un autre moteur");
  }

  const now = new Date();
  const observed = input.observedState ? parseState(input.observedState) : null;

  await db.insert(commandAcks).values({
    commandId: command.id,
    engineId,
    ack,
    code: input.code?.slice(0, 48) ?? null,
    message: input.message?.slice(0, 300) ?? null,
  });

  const terminal = ["completed", "failed", "rejected"].includes(ack);
  const status =
    ack === "received"
      ? "received"
      : ack === "accepted"
        ? "accepted"
        : ack === "started"
          ? "started"
          : ack;

  await db
    .update(commands)
    .set({
      status,
      engineId,
      acceptedAt: ack === "accepted" ? now : command.acceptedAt,
      startedAt: ack === "started" ? now : command.startedAt,
      completedAt: terminal ? now : command.completedAt,
      lastTransitionCode: input.code?.slice(0, 48) ?? null,
      lastTransitionMessage: input.message?.slice(0, 300) ?? null,
      updatedAt: now,
    })
    .where(eq(commands.id, command.id));

  if (observed) {
    await db
      .update(instances)
      .set({
        state: observed,
        engineConfirmedState: observed,
        lastEngineSeenAt: now,
        updatedAt: now,
        ...(observed === "STOPPED"
          ? {
              stoppedAt: now,
              newEntriesBlocked: false,
            }
          : {}),
      })
      .where(eq(instances.id, command.instanceId));
  } else {
    await db
      .update(instances)
      .set({ lastEngineSeenAt: now, updatedAt: now })
      .where(eq(instances.id, command.instanceId));
  }

  if (ack === "started" && (observed === "RUNNING" || command.type === "start")) {
    await openRun(command.instanceId, command.requestedBy);
  }
  if (terminal && observed === "STOPPED") {
    await closeRun(command.instanceId, input.code ?? command.lastTransitionCode ?? "stopped");
  }

  return { ok: true };
}

async function openRun(instanceId: string, userId: string): Promise<void> {
  const db = getDb();
  const open = await db
    .select({ id: robotRuns.id })
    .from(robotRuns)
    .where(and(eq(robotRuns.instanceId, instanceId), isNull(robotRuns.endedAt)))
    .limit(1);
  if (open[0]) return;

  const account = await db
    .select({ equity: tradingAccounts.lastEquity })
    .from(instances)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, instances.tradingAccountId))
    .where(eq(instances.id, instanceId))
    .limit(1);
  await db.insert(robotRuns).values({
    instanceId,
    startedBy: userId,
    startEquity: account[0]?.equity ?? null,
  });
}

async function closeRun(instanceId: string, reason: string): Promise<void> {
  const db = getDb();
  const runRows = await db
    .select()
    .from(robotRuns)
    .where(and(eq(robotRuns.instanceId, instanceId), isNull(robotRuns.endedAt)))
    .orderBy(desc(robotRuns.startedAt))
    .limit(1);
  const run = runRows[0];
  if (!run) return;

  const instanceRows = await db
    .select({
      equity: tradingAccounts.lastEquity,
      stopReason: instances.stopReason,
    })
    .from(instances)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, instances.tradingAccountId))
    .where(eq(instances.id, instanceId))
    .limit(1);
  const current = instanceRows[0];

  const netRows = await db
    .select({
      net: sql<string>`coalesce(sum(case when ${tradeEvents.result} ~ '^-?[0-9.]+$' then ${tradeEvents.result}::numeric else 0 end), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(tradeEvents)
    .where(
      and(
        eq(tradeEvents.instanceId, instanceId),
        eq(tradeEvents.eventType, "position_closed"),
        sql`${tradeEvents.occurredAt} >= ${run.startedAt}`,
      ),
    );

  await db
    .update(robotRuns)
    .set({
      endedAt: new Date(),
      endEquity: current?.equity ?? null,
      netResult: netRows[0]?.net ?? "0",
      tradesCount: netRows[0]?.count ?? 0,
      stopReason: current?.stopReason ?? reason,
    })
    .where(eq(robotRuns.id, run.id));
}

interface HeartbeatBody {
  engine_version: string;
  terminal_kind: string;
  state: string;
  broker_connected?: boolean;
  metrics?: Record<string, unknown>;
  instance_states?: Array<{ instance_id: string; state: string }>;
  accounts?: Array<{
    account_id: string;
    equity?: string;
    balance?: string;
    margin_level_pct?: string;
    currency?: string;
    observed_at?: string;
  }>;
}

export async function recordHeartbeat(engineId: string, body: HeartbeatBody) {
  const db = getDb();
  const now = new Date();
  await db.insert(engineHeartbeats).values({
    engineId,
    engineVersion: body.engine_version?.slice(0, 32) ?? "unknown",
    terminalKind: body.terminal_kind?.slice(0, 32) ?? "unknown",
    state: body.state?.slice(0, 32) ?? "unknown",
    metrics: (body.metrics ?? {}) as Record<string, unknown>,
  });

  for (const entry of body.instance_states ?? []) {
    if (!INSTANCE_STATES.includes(entry.state as InstanceState)) continue;
    const pending = await db
      .select({ id: commands.id })
      .from(commands)
      .where(
        and(
          eq(commands.instanceId, entry.instance_id),
          inArray(commands.status, ["requested", "received"]),
        ),
      )
      .limit(1);
    await db
      .update(instances)
      .set({
        engineConfirmedState: entry.state as InstanceState,
        lastEngineSeenAt: now,
        ...(pending[0] ? {} : { state: entry.state as InstanceState }),
        updatedAt: now,
      })
      .where(eq(instances.id, entry.instance_id));
  }

  for (const account of body.accounts ?? []) {
    await db
      .update(tradingAccounts)
      .set({
        lastEquity: account.equity ?? null,
        lastBalance: account.balance ?? null,
        lastMarginLevel: account.margin_level_pct ?? null,
        lastCurrency: account.currency?.slice(0, 8) ?? null,
        lastSnapshotAt: now,
        updatedAt: now,
      })
      .where(eq(tradingAccounts.id, account.account_id));
  }

  // Aucune licence active : la version mono-admin ne bloque rien. La structure
  // de réponse reste compatible avec le contrat du moteur.
  return { licenses: {} };
}

interface EventPayload {
  event_type?: string;
  symbol?: string;
  volume?: string;
  price?: string;
  result?: string;
  retcode?: string;
  broker_ticket?: string;
  occurred_at?: string;
  detail?: Record<string, unknown>;
}

const EVENT_TYPES = [
  "order_sent",
  "order_accepted",
  "order_rejected",
  "position_opened",
  "position_modified",
  "position_closed",
  "deal",
  "reconnect",
  "risk_block",
  "engine_error",
] as const;

export async function ingestEvents(
  body: {
    trading_account_id: string;
    instance_id?: string | null;
    events?: EventPayload[];
    positions?: Array<{
      position_id: string;
      symbol: string;
      side: string;
      volume: string;
      open_price: string;
      current_price?: string;
      profit?: string;
      margin?: string;
      observed_at?: string;
    }>;
    account?: {
      equity?: string;
      balance?: string;
      margin_level_pct?: string;
      currency?: string;
    };
  },
  engineId: string,
) {
  const db = getDb();
  if (!body.trading_account_id) throw badRequest("trading_account_id requis");

  const accountRows = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, body.trading_account_id))
    .limit(1);
  const account = accountRows[0];
  if (!account) throw notFound("Compte de trading introuvable");

  const instanceRows = body.instance_id
    ? await db
        .select()
        .from(instances)
        .where(
          and(
            eq(instances.id, body.instance_id),
            eq(instances.tradingAccountId, account.id),
            eq(instances.ownerUserId, account.ownerUserId),
          ),
        )
        .limit(1)
    : [];
  if (body.instance_id && !instanceRows[0]) {
    throw badRequest("Instance incohérente avec le compte");
  }

  const now = new Date();
  const events = (body.events ?? []).slice(0, 200);
  for (const event of events) {
    const type = (EVENT_TYPES as readonly string[]).includes(event.event_type ?? "")
      ? (event.event_type as (typeof EVENT_TYPES)[number])
      : "engine_error";
    const occurredAt = event.occurred_at ? new Date(event.occurred_at) : now;
    if (Number.isNaN(occurredAt.getTime())) continue;

    await db.insert(tradeEvents).values({
      tradingAccountId: account.id,
      instanceId: body.instance_id ?? null,
      ownerUserId: account.ownerUserId,
      brokerTicket: event.broker_ticket?.slice(0, 64) ?? null,
      eventType: type,
      symbol: event.symbol?.slice(0, 32) ?? null,
      volume: event.volume ?? null,
      price: event.price ?? null,
      result: event.result?.slice(0, 64) ?? null,
      retcode: event.retcode?.slice(0, 32) ?? null,
      detail: event.detail ?? {},
      occurredAt,
    });

    if (type === "position_closed" && body.instance_id) {
      const realized = numericOrZero(event.result);
      const commissions = numericOrZero(asString(event.detail?.commissions));
      const swaps = numericOrZero(asString(event.detail?.swaps));
      const net = realized - commissions - swaps;
      const day = occurredAt.toISOString().slice(0, 10);
      await db
        .insert(dailyMetrics)
        .values({
          instanceId: body.instance_id,
          metricDate: day,
          realizedPnl: realized.toFixed(8),
          commissions: commissions.toFixed(8),
          swaps: swaps.toFixed(8),
          netPnl: net.toFixed(8),
          tradesCount: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [dailyMetrics.instanceId, dailyMetrics.metricDate],
          set: {
            realizedPnl: sql`(${dailyMetrics.realizedPnl}::numeric + ${realized.toFixed(8)}::numeric)::text`,
            commissions: sql`(${dailyMetrics.commissions}::numeric + ${commissions.toFixed(8)}::numeric)::text`,
            swaps: sql`(${dailyMetrics.swaps}::numeric + ${swaps.toFixed(8)}::numeric)::text`,
            netPnl: sql`(${dailyMetrics.netPnl}::numeric + ${net.toFixed(8)}::numeric)::text`,
            tradesCount: sql`${dailyMetrics.tradesCount} + 1`,
            updatedAt: now,
          },
        });

      if (event.broker_ticket) {
        await db
          .update(positionsSnapshots)
          .set({ closeTime: occurredAt })
          .where(
            and(
              eq(positionsSnapshots.tradingAccountId, account.id),
              eq(positionsSnapshots.positionId, event.broker_ticket),
            ),
          );
      }
      await db
        .update(robotRuns)
        .set({ tradesCount: sql`${robotRuns.tradesCount} + 1` })
        .where(and(eq(robotRuns.instanceId, body.instance_id), isNull(robotRuns.endedAt)));
    }

    if (type === "risk_block" && body.instance_id && event.detail?.objective) {
      const reason = asString(event.detail.reason) || event.result || "objectif atteint";
      await db
        .update(instances)
        .set({ stopReason: reason.slice(0, 500), updatedAt: now })
        .where(eq(instances.id, body.instance_id));
    }
  }

  for (const position of (body.positions ?? []).slice(0, 100)) {
    const side = position.side === "sell" ? "sell" : "buy";
    await db
      .insert(positionsSnapshots)
      .values({
        tradingAccountId: account.id,
        instanceId: body.instance_id ?? null,
        ownerUserId: account.ownerUserId,
        symbol: position.symbol.slice(0, 32),
        positionId: position.position_id.slice(0, 64),
        side,
        volume: position.volume,
        openPrice: position.open_price,
        currentPrice: position.current_price ?? null,
        profit: position.profit ?? null,
        margin: position.margin ?? null,
        observedAt: position.observed_at ? new Date(position.observed_at) : now,
      })
      .onConflictDoNothing();
  }

  if (body.account) {
    await db
      .update(tradingAccounts)
      .set({
        lastEquity: body.account.equity ?? null,
        lastBalance: body.account.balance ?? null,
        lastMarginLevel: body.account.margin_level_pct ?? null,
        lastCurrency: body.account.currency?.slice(0, 8) ?? null,
        lastSnapshotAt: now,
        updatedAt: now,
      })
      .where(eq(tradingAccounts.id, account.id));
  }

  return { accepted: true, engine_id: engineId };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numericOrZero(value: string | undefined): number {
  if (!value || !/^-?\d+(\.\d+)?$/.test(value)) return 0;
  return Number(value);
}

export async function pendingConnectionTests(engineId: string, limit = 5) {
  const db = getDb();
  const rows = await db
    .select({
      test: connectionTests,
      account: tradingAccounts,
    })
    .from(connectionTests)
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, connectionTests.tradingAccountId))
    .where(eq(connectionTests.status, "pending"))
    .orderBy(asc(connectionTests.requestedAt))
    .limit(limit);

  const tests = [];
  for (const row of rows) {
    await db
      .update(connectionTests)
      .set({ status: "running", engineId })
      .where(eq(connectionTests.id, row.test.id));
    tests.push({
      connection_test_id: row.test.id,
      account_id: row.account.id,
      broker: row.account.broker,
      server: row.account.server,
      login: row.account.login,
      environment: row.account.environment,
    });
  }
  return { tests };
}

export async function acknowledgeConnectionTest(body: {
  connection_test_id: string;
  status: string;
  code?: string;
  message?: string;
}) {
  const db = getDb();
  const rows = await db
    .select()
    .from(connectionTests)
    .where(eq(connectionTests.id, body.connection_test_id))
    .limit(1);
  const test = rows[0];
  if (!test) throw notFound("Test de connexion introuvable");

  const success = body.status === "connected";
  const now = new Date();
  await db
    .update(connectionTests)
    .set({
      status: success ? "connected" : "failed",
      resultCode: body.code?.slice(0, 48) ?? null,
      resultMessage: body.message?.slice(0, 300) ?? null,
      completedAt: now,
    })
    .where(eq(connectionTests.id, test.id));

  await db
    .update(tradingAccounts)
    .set({
      status: success ? "connected" : "error",
      lastTestAt: now,
      lastTestResult: success ? "connected" : body.code?.slice(0, 48) ?? "failed",
      updatedAt: now,
    })
    .where(eq(tradingAccounts.id, test.tradingAccountId));

  return { ok: true };
}

export async function revealEngineSecret(
  accountId: string,
  purpose: string,
  nonce: string,
  engineId: string,
) {
  if (!["connect", "test_connection"].includes(purpose)) {
    throw badRequest("Usage de secret non autorisé");
  }
  if (!nonce || nonce.length < 8) throw badRequest("Nonce requis");
  const secret = await revealAccountSecret(accountId);
  await recordAudit({
    actorKind: "engine",
    action: "engine.secret_revealed",
    targetType: "trading_account",
    targetId: accountId,
    metadata: { purpose, engine_id: engineId, nonce: nonce.slice(0, 8) },
  });
  return { secret, expires_in_seconds: 60 };
}

export async function engineStatus() {
  const db = getDb();
  const rows = await db
    .select()
    .from(engineHeartbeats)
    .orderBy(desc(engineHeartbeats.lastSeenAt))
    .limit(1);
  const heartbeat = rows[0];
  if (!heartbeat) {
    return {
      online: false,
      engineId: null,
      lastSeenAt: null,
      terminalKind: null,
      version: null,
      state: "UNKNOWN",
      metrics: {},
    };
  }
  return {
    online: Date.now() - heartbeat.lastSeenAt.getTime() < ENGINE_SILENCE_MS,
    engineId: heartbeat.engineId,
    lastSeenAt: heartbeat.lastSeenAt,
    terminalKind: heartbeat.terminalKind,
    version: heartbeat.engineVersion,
    state: heartbeat.state,
    metrics: heartbeat.metrics as Record<string, unknown>,
  };
}

export async function expireStaleCommands(): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(commands)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        inArray(commands.status, ["requested", "received"]),
        lt(commands.expiresAt, new Date()),
      ),
    )
    .returning({ id: commands.id });
  return rows.length;
}

/** Réconciliation à appeler au démarrage du backend si des états sont orphelins. */
export async function reconcileOrphanRuns(): Promise<number> {
  const db = getDb();
  const stale = await db
    .select({ id: robotRuns.id })
    .from(robotRuns)
    .innerJoin(instances, eq(instances.id, robotRuns.instanceId))
    .where(
      and(
        isNull(robotRuns.endedAt),
        or(eq(instances.state, "STOPPED"), eq(instances.state, "ERROR")),
      ),
    );
  for (const run of stale) {
    await db
      .update(robotRuns)
      .set({ endedAt: new Date(), stopReason: "réconciliation" })
      .where(eq(robotRuns.id, run.id));
  }
  return stale.length;
}
