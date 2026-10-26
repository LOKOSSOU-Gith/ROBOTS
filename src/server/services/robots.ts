/**
 * Gestion des robots et commandes (§5, §7, §8.1).
 *
 * Aucune réponse de démarrage n'affirme que le robot tourne : la commande est
 * persistée, l'état passe à STARTING, et seul un accusé du moteur confirme
 * RUNNING. Le frontend interroge ensuite l'état confirmé.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  commandAcks,
  commands,
  dailyMetrics,
  instances,
  positionsSnapshots,
  riskProfiles,
  robotSettings,
  strategies,
  strategyVersions,
  tradeEvents,
  tradingAccounts,
} from "@/server/db/schema";
import { validateParameters, type ParameterSchema } from "@/server/domain/parameters";
import { robotSettingsSchema, type RobotSettingsInput } from "@/server/domain/robotSettings";
import { canStart, effectiveState, type InstanceState } from "@/server/domain/states";
import { toScaled } from "@/server/domain/volume";
import {
  ApiError,
  badRequest,
  conflict,
  notFound,
} from "@/server/http/api";
import { recordAudit } from "./audit";

const COMMAND_TTL_SECONDS = Number(process.env.COMMAND_TTL_SECONDS || 120);

export interface RobotView {
  id: string;
  accountId: string;
  name: string;
  shortName: string;
  strategySlug: string;
  description: string;
  state: InstanceState;
  reportedState: InstanceState;
  confirmedState: InstanceState;
  mode: string;
  symbol: string;
  timeframe: string;
  initialLot: string;
  profitTargetNet: string;
  maxLossNet: string;
  profitReference: "session" | "day";
  maxTrades: number;
  maxPositions: number;
  maxSpreadPoints: number;
  stopPolicy: "keep_positions" | "close_positions";
  lastEngineSeenAt: Date | null;
  stopReason: string | null;
  newEntriesBlocked: boolean;
  openPositions: number;
  realizedPnl: string;
  lastActivityAt: Date | null;
  accountEnvironment: "demo" | "real";
  realApproved: boolean;
}

type RobotRow = {
  instance: typeof instances.$inferSelect;
  settings: typeof robotSettings.$inferSelect | null;
  strategyName: string;
  strategySlug: string;
  strategyShort: string;
  description: string;
  account: typeof tradingAccounts.$inferSelect;
};

async function robotRows(userId: string, robotId?: string): Promise<RobotRow[]> {
  const db = getDb();
  const filters = [eq(instances.ownerUserId, userId)];
  if (robotId) filters.push(eq(instances.id, robotId));

  const rows = await db
    .select({
      instance: instances,
      settings: robotSettings,
      strategyName: strategies.name,
      strategySlug: strategies.slug,
      description: strategies.description,
      account: tradingAccounts,
    })
    .from(instances)
    .innerJoin(strategyVersions, eq(strategyVersions.id, instances.strategyVersionId))
    .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
    .innerJoin(tradingAccounts, eq(tradingAccounts.id, instances.tradingAccountId))
    .leftJoin(robotSettings, eq(robotSettings.instanceId, instances.id))
    .where(and(...filters))
    .orderBy(desc(instances.createdAt));

  return rows.map((row) => ({
    ...row,
    strategyShort: row.strategySlug,
  }));
}

async function aggregate(userId: string, robotIds: string[]) {
  const db = getDb();
  if (robotIds.length === 0) return new Map<string, { pnl: string; positions: number; last: Date | null }>();

  const positionRows = await db
    .select({
      instanceId: positionsSnapshots.instanceId,
      count: sql<number>`count(*)::int`,
      last: sql<Date | null>`max(${positionsSnapshots.observedAt})`,
    })
    .from(positionsSnapshots)
    .where(inArray(positionsSnapshots.instanceId, robotIds))
    .groupBy(positionsSnapshots.instanceId);

  const pnlRows = await db
    .select({
      instanceId: tradeEvents.instanceId,
      pnl: sql<string>`coalesce(sum(case when ${tradeEvents.result} ~ '^-?[0-9.]+$' then ${tradeEvents.result}::numeric else 0 end), 0)::text`,
      last: sql<Date | null>`max(${tradeEvents.occurredAt})`,
    })
    .from(tradeEvents)
    .where(
      and(
        inArray(tradeEvents.instanceId, robotIds),
        eq(tradeEvents.eventType, "position_closed"),
        eq(tradeEvents.ownerUserId, userId),
      ),
    )
    .groupBy(tradeEvents.instanceId);

  const map = new Map<string, { pnl: string; positions: number; last: Date | null }>();
  for (const id of robotIds) map.set(id, { pnl: "0", positions: 0, last: null });
  for (const row of positionRows) {
    if (!row.instanceId) continue;
    const entry = map.get(row.instanceId);
    if (entry) entry.positions = row.count;
  }
  for (const row of pnlRows) {
    if (!row.instanceId) continue;
    const entry = map.get(row.instanceId);
    if (entry) {
      entry.pnl = row.pnl;
      entry.last = row.last ? new Date(row.last) : null;
    }
  }
  return map;
}

function toView(row: RobotRow, stats: { pnl: string; positions: number; last: Date | null }): RobotView {
  const settings = row.settings;
  return {
    id: row.instance.id,
    accountId: row.instance.tradingAccountId,
    name: row.strategyName,
    shortName: row.strategySlug,
    strategySlug: row.strategySlug,
    description: row.description,
    state: effectiveState(row.instance.state, row.instance.lastEngineSeenAt),
    reportedState: row.instance.state,
    confirmedState: row.instance.engineConfirmedState,
    mode: row.instance.mode,
    symbol: settings?.symbol ?? "—",
    timeframe: settings?.timeframe ?? "—",
    initialLot: settings?.initialLot ?? "—",
    profitTargetNet: settings?.profitTargetNet ?? "—",
    maxLossNet: settings?.maxLossNet ?? "—",
    profitReference: settings?.profitReference ?? "session",
    maxTrades: settings?.maxTrades ?? 0,
    maxPositions: settings?.maxPositions ?? 0,
    maxSpreadPoints: settings?.maxSpreadPoints ?? 0,
    stopPolicy: settings?.stopPolicy ?? "keep_positions",
    lastEngineSeenAt: row.instance.lastEngineSeenAt,
    stopReason: row.instance.stopReason,
    newEntriesBlocked: row.instance.newEntriesBlocked,
    openPositions: stats.positions,
    realizedPnl: stats.pnl,
    lastActivityAt:
      stats.last && row.instance.lastEngineSeenAt
        ? new Date(Math.max(stats.last.getTime(), row.instance.lastEngineSeenAt.getTime()))
        : stats.last ?? row.instance.lastEngineSeenAt,
    accountEnvironment: row.account.environment,
    realApproved: Boolean(row.account.realModeApprovedAt),
  };
}

export async function listRobots(userId: string): Promise<RobotView[]> {
  const rows = await robotRows(userId);
  const stats = await aggregate(
    userId,
    rows.map((row) => row.instance.id),
  );
  return rows.map((row) =>
    toView(row, stats.get(row.instance.id) ?? { pnl: "0", positions: 0, last: null }),
  );
}

export interface RobotDetail extends RobotView {
  parameters: Record<string, unknown>;
  parameterSchema: ParameterSchema;
  supportedSymbols: string[];
  risk: {
    maxDailyLoss: string;
    maxDrawdownPct: string;
    maxOpenPositions: number;
    maxSpreadPoints: number;
    maxLotSize: string;
    minMarginLevelPct: string;
    maxRiskPerTradePct: string;
  };
  allowedHours: { start: number; end: number };
  account: {
    id: string;
    broker: string;
    server: string;
    environment: "demo" | "real";
    status: string;
  };
  artifactDigest: string;
  lastCommands: Array<{
    id: string;
    type: string;
    status: string;
    code: string | null;
    message: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }>;
}

export async function getRobot(userId: string, robotId: string): Promise<RobotDetail> {
  const db = getDb();
  const rows = await robotRows(userId, robotId);
  const row = rows[0];
  if (!row) throw notFound("Robot introuvable");
  const stats = await aggregate(userId, [robotId]);

  const strategyRows = await db
    .select({
      schema: strategyVersions.parameterSchema,
      supported: strategyVersions.supportedSymbols,
      artifactDigest: strategyVersions.artifactDigest,
      risk: riskProfiles,
    })
    .from(instances)
    .innerJoin(strategyVersions, eq(strategyVersions.id, instances.strategyVersionId))
    .innerJoin(riskProfiles, eq(riskProfiles.id, instances.riskProfileId))
    .where(eq(instances.id, robotId))
    .limit(1);
  const strategyRow = strategyRows[0];
  if (!strategyRow) throw notFound("Stratégie du robot introuvable");

  const commandRows = await db
    .select({
      id: commands.id,
      type: commands.type,
      status: commands.status,
      code: commands.lastTransitionCode,
      message: commands.lastTransitionMessage,
      createdAt: commands.createdAt,
      completedAt: commands.completedAt,
    })
    .from(commands)
    .where(eq(commands.instanceId, robotId))
    .orderBy(desc(commands.createdAt))
    .limit(10);

  return {
    ...toView(row, stats.get(robotId) ?? { pnl: "0", positions: 0, last: null }),
    parameters: (row.instance.parameters ?? {}) as Record<string, unknown>,
    parameterSchema: strategyRow.schema as ParameterSchema,
    supportedSymbols: (strategyRow.supported as string[]) ?? [],
    risk: {
      maxDailyLoss: strategyRow.risk.maxDailyLoss,
      maxDrawdownPct: strategyRow.risk.maxDrawdownPct,
      maxOpenPositions: strategyRow.risk.maxOpenPositions,
      maxSpreadPoints: strategyRow.risk.maxSpreadPoints,
      maxLotSize: strategyRow.risk.maxLotSize,
      minMarginLevelPct: strategyRow.risk.minMarginLevelPct,
      maxRiskPerTradePct: strategyRow.risk.maxRiskPerTradePct,
    },
    allowedHours: (row.settings?.allowedHours as { start: number; end: number }) ?? {
      start: 0,
      end: 24,
    },
    account: {
      id: row.account.id,
      broker: row.account.broker,
      server: row.account.server,
      environment: row.account.environment,
      status: row.account.status,
    },
    artifactDigest: strategyRow.artifactDigest,
    lastCommands: commandRows,
  };
}

/** Mise à jour validée côté serveur, même si le frontend a déjà validé (§5). */
export async function updateRobotSettings(
  userId: string,
  robotId: string,
  raw: unknown,
  meta: { idempotencyKey: string; ipHash?: string | null },
): Promise<{ robot: RobotDetail; commandId: string | null; reloadRequired: boolean }> {
  const input: RobotSettingsInput = robotSettingsSchema.parse(raw);
  const db = getDb();
  const detail = await getRobot(userId, robotId);

  const supported = detail.supportedSymbols.map((symbol) => symbol.toUpperCase());
  if (!supported.includes(input.symbol.toUpperCase())) {
    throw badRequest(
      `Symbole non pris en charge par cette stratégie (autorisés : ${supported.join(", ")})`,
    );
  }
  if (toScaled(input.initialLot) > toScaled(detail.risk.maxLotSize)) {
    throw badRequest(`Le lot initial dépasse le plafond du profil de risque (${detail.risk.maxLotSize})`);
  }
  if (input.maxPositions > detail.risk.maxOpenPositions) {
    throw badRequest(
      `Le nombre maximal de positions dépasse la limite du profil (${detail.risk.maxOpenPositions})`,
    );
  }
  if (input.maxSpreadPoints > detail.risk.maxSpreadPoints) {
    throw badRequest(
      `Le spread maximal dépasse la limite du profil (${detail.risk.maxSpreadPoints} points)`,
    );
  }

  const validation = validateParameters(detail.parameterSchema, input.strategyParameters);
  if (!validation.ok) {
    throw new ApiError(422, "invalid_parameters", "Paramètres de stratégie invalides", {
      issues: validation.issues,
    });
  }

  const live = ["STARTING", "RUNNING", "STOPPING"].includes(detail.reportedState);
  if (live) {
    // Modification à chaud : le moteur recharge la configuration par commande.
    const queued = await enqueueCommand(userId, robotId, "update_parameters", {}, meta);
    await db
      .update(robotSettings)
      .set({
        symbol: input.symbol.toUpperCase(),
        timeframe: input.timeframe,
        initialLot: input.initialLot,
        profitTargetNet: input.profitTargetNet,
        maxLossNet: input.maxLossNet,
        profitReference: input.profitReference,
        maxTrades: input.maxTrades,
        maxPositions: input.maxPositions,
        maxSpreadPoints: input.maxSpreadPoints,
        allowedHours: input.allowedHours,
        strategyParameters: validation.values,
        stopPolicy: input.stopPolicy,
        updatedAt: new Date(),
      })
      .where(eq(robotSettings.instanceId, robotId));
    await db
      .update(instances)
      .set({
        symbols: [input.symbol.toUpperCase()],
        parameters: validation.values,
        artifactDigest: detail.artifactDigest,
        updatedAt: new Date(),
      })
      .where(eq(instances.id, robotId));
    await recordAudit({
      actorUserId: userId,
      action: "robot.settings_updated",
      targetType: "instance",
      targetId: robotId,
      metadata: {
        live: true,
        command_id: queued.commandId,
        symbol: input.symbol,
        profit_target_net: input.profitTargetNet,
        max_loss_net: input.maxLossNet,
      },
      ipHash: meta.ipHash,
    });
    return { robot: await getRobot(userId, robotId), commandId: queued.commandId, reloadRequired: true };
  }

  await db
    .update(robotSettings)
    .set({
      symbol: input.symbol.toUpperCase(),
      timeframe: input.timeframe,
      initialLot: input.initialLot,
      profitTargetNet: input.profitTargetNet,
      maxLossNet: input.maxLossNet,
      profitReference: input.profitReference,
      maxTrades: input.maxTrades,
      maxPositions: input.maxPositions,
      maxSpreadPoints: input.maxSpreadPoints,
      allowedHours: input.allowedHours,
      strategyParameters: validation.values,
      stopPolicy: input.stopPolicy,
      updatedAt: new Date(),
    })
    .where(eq(robotSettings.instanceId, robotId));
  await db
    .update(instances)
    .set({
      symbols: [input.symbol.toUpperCase()],
      parameters: validation.values,
      artifactDigest: detail.artifactDigest,
      updatedAt: new Date(),
    })
    .where(eq(instances.id, robotId));

  await recordAudit({
    actorUserId: userId,
    action: "robot.settings_updated",
    targetType: "instance",
    targetId: robotId,
    metadata: {
      live: false,
      symbol: input.symbol,
      profit_target_net: input.profitTargetNet,
      max_loss_net: input.maxLossNet,
    },
    ipHash: meta.ipHash,
  });

  return { robot: await getRobot(userId, robotId), commandId: null, reloadRequired: false };
}

export type RobotCommandType =
  | "start"
  | "stop_strategy"
  | "stop_new_entries"
  | "emergency_close";

export interface CommandResult {
  commandId: string | null;
  status: string;
  state: InstanceState;
  alreadyInState: boolean;
}

/**
 * Persiste une commande idempotente. La clé d'idempotence est unique en base :
 * un double clic ou un retry réseau renvoie la même commande.
 */
export async function enqueueCommand(
  userId: string,
  robotId: string,
  type: RobotCommandType | "update_parameters" | "reload_policy",
  payload: Record<string, unknown>,
  meta: { idempotencyKey: string; ipHash?: string | null },
): Promise<CommandResult> {
  const db = getDb();
  if (!meta.idempotencyKey || meta.idempotencyKey.length < 8) {
    throw badRequest("Clé d'idempotence absente ou trop courte");
  }

  const existing = await db
    .select()
    .from(commands)
    .where(eq(commands.idempotencyKey, meta.idempotencyKey))
    .limit(1);
  if (existing[0]) {
    if (existing[0].instanceId !== robotId || existing[0].requestedBy !== userId) {
      throw conflict("Clé d'idempotence déjà utilisée");
    }
    const stateRows = await db
      .select({ state: instances.state })
      .from(instances)
      .where(eq(instances.id, robotId))
      .limit(1);
    return {
      commandId: existing[0].id,
      status: existing[0].status,
      state: stateRows[0]?.state ?? "STOPPED",
      alreadyInState: false,
    };
  }

  const pretty = await getRobot(userId, robotId);

  if (type === "start") {
    if (!canStart(pretty.reportedState)) {
      if (pretty.reportedState === "STARTING" || pretty.reportedState === "RUNNING") {
        return { commandId: null, status: "already_started", state: pretty.reportedState, alreadyInState: true };
      }
      throw conflict(`Démarrage impossible depuis l'état ${pretty.reportedState}`);
    }
    if (pretty.accountEnvironment === "real" && !pretty.realApproved) {
      throw forbiddenReal();
    }
  }

  if (type === "stop_strategy" || type === "emergency_close") {
    if (pretty.reportedState === "STOPPED") {
      return { commandId: null, status: "already_stopped", state: "STOPPED", alreadyInState: true };
    }
  }

  if (type === "stop_new_entries" && !["RUNNING", "STARTING"].includes(pretty.reportedState)) {
    return {
      commandId: null,
      status: "not_running",
      state: pretty.reportedState,
      alreadyInState: true,
    };
  }

  const nextState: InstanceState | null =
    type === "start"
      ? "STARTING"
      : type === "stop_new_entries"
        ? null
        : "STOPPING";

  const expiresAt = new Date(Date.now() + COMMAND_TTL_SECONDS * 1000);

  const inserted = await db.transaction(async (tx) => {
    const commandRows = await tx
      .insert(commands)
      .values({
        instanceId: robotId,
        type,
        idempotencyKey: meta.idempotencyKey,
        requestedBy: userId,
        payload,
        status: "requested",
        expiresAt,
      })
      .returning({ id: commands.id, status: commands.status });

    if (nextState) {
      await tx
        .update(instances)
        .set({
          state: nextState,
          stopReason: type === "start" ? null : undefined,
          stoppedAt: type === "start" ? null : undefined,
          ...(type === "start" ? { newEntriesBlocked: false } : {}),
          updatedAt: new Date(),
        })
        .where(eq(instances.id, robotId));
    }
    if (type === "stop_new_entries") {
      await tx
        .update(instances)
        .set({ newEntriesBlocked: true, updatedAt: new Date() })
        .where(eq(instances.id, robotId));
    }
    return commandRows[0];
  });

  if (!inserted) throw new Error("commande non créée");

  await recordAudit({
    actorUserId: userId,
    action: `robot.${type}`,
    targetType: "instance",
    targetId: robotId,
    metadata: { command_id: inserted.id, idempotency_key: meta.idempotencyKey },
    ipHash: meta.ipHash,
  });

  return {
    commandId: inserted.id,
    status: inserted.status,
    state: nextState ?? pretty.reportedState,
    alreadyInState: false,
  };
}

function forbiddenReal(): ApiError {
  return new ApiError(
    403,
    "real_mode_not_approved",
    "Le mode réel doit être explicitement approuvé pour ce compte avant tout démarrage",
  );
}

export async function startRobot(
  userId: string,
  robotId: string,
  meta: { idempotencyKey: string; ipHash?: string | null },
): Promise<CommandResult> {
  const robot = await getRobot(userId, robotId);
  if (robot.accountEnvironment === "real" && !robot.realApproved) throw forbiddenReal();
  return enqueueCommand(userId, robotId, "start", {}, meta);
}

export async function stopRobot(
  userId: string,
  robotId: string,
  meta: { idempotencyKey: string; ipHash?: string | null },
): Promise<CommandResult> {
  const robot = await getRobot(userId, robotId);
  return enqueueCommand(
    userId,
    robotId,
    "stop_strategy",
    { close_positions: robot.stopPolicy === "close_positions" },
    meta,
  );
}

export async function suspendRobot(
  userId: string,
  robotId: string,
  meta: { idempotencyKey: string; ipHash?: string | null },
): Promise<CommandResult> {
  return enqueueCommand(userId, robotId, "stop_new_entries", {}, meta);
}

export async function emergencyCloseRobot(
  userId: string,
  robotId: string,
  meta: { idempotencyKey: string; ipHash?: string | null },
): Promise<CommandResult> {
  return enqueueCommand(userId, robotId, "emergency_close", { confirm_phrase: "LIQUIDER" }, meta);
}

/** Arrêt d'urgence global : une commande par robot actif (§7). */
export async function emergencyStopAll(
  userId: string,
  meta: { idempotencyKey: string; ipHash?: string | null },
): Promise<{ robots: number; commandIds: string[] }> {
  const robots = await listRobots(userId);
  const active = robots.filter((robot) => ["STARTING", "RUNNING", "STOPPING", "ERROR", "RISK_HALTED", "DISCONNECTED"].includes(robot.state));
  const commandIds: string[] = [];
  for (const [index, robot] of active.entries()) {
    const result = await emergencyCloseRobot(userId, robot.id, {
      idempotencyKey: `${meta.idempotencyKey}:${index}`,
      ipHash: meta.ipHash,
    });
    if (result.commandId) commandIds.push(result.commandId);
  }
  await recordAudit({
    actorUserId: userId,
    action: "robot.emergency_stop_all",
    targetType: "account",
    targetId: null,
    metadata: { robots: active.length, commands: commandIds.length },
    ipHash: meta.ipHash,
  });
  return { robots: active.length, commandIds };
}

export async function robotStatus(userId: string, robotId: string) {
  const robot = await getRobot(userId, robotId);
  return {
    id: robot.id,
    state: effectiveState(robot.state, robot.lastEngineSeenAt),
    confirmedState: robot.confirmedState,
    lastEngineSeenAt: robot.lastEngineSeenAt,
    stopReason: robot.stopReason,
    newEntriesBlocked: robot.newEntriesBlocked,
    lastCommands: robot.lastCommands,
  };
}

export async function robotMetrics(userId: string, robotId: string) {
  const db = getDb();
  await getRobot(userId, robotId);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const metrics = await db
    .select()
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.instanceId, robotId), gte(dailyMetrics.metricDate, since.toISOString().slice(0, 10))))
    .orderBy(desc(dailyMetrics.metricDate));
  const acks = await db
    .select()
    .from(commandAcks)
    .innerJoin(commands, eq(commands.id, commandAcks.commandId))
    .where(eq(commands.instanceId, robotId))
    .orderBy(desc(commandAcks.reportedAt))
    .limit(10);
  return { metrics, acknowledgements: acks.map((row) => row.command_acks) };
}
