/**
 * Schéma PostgreSQL de la plateforme (§9 du cahier des charges).
 *
 * Les tables multi-clients existantes sont conservées (le modèle de données
 * reste prêt pour plusieurs propriétaires) même si cette version est
 * mono-administrateur. Les contrôles d'accès serveur restent obligatoires :
 * Row-Level Security ne remplace jamais une autorisation applicative.
 */

import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// --------------------------------------------------------------------- enums §9

export const accountEnvironment = pgEnum("account_environment", ["demo", "real"]);
export const accountStatus = pgEnum("account_status", [
  "unverified",
  "connected",
  "disconnected",
  "error",
  "disabled",
]);
export const commandStatus = pgEnum("command_status", [
  "requested",
  "received",
  "accepted",
  "started",
  "completed",
  "failed",
  "rejected",
  "expired",
]);
export const commandType = pgEnum("command_type", [
  "start",
  "stop_new_entries",
  "stop_strategy",
  "emergency_close",
  "update_parameters",
  "reload_policy",
]);
export const instanceMode = pgEnum("instance_mode", ["simulation", "demo", "real"]);
export const instanceState = pgEnum("instance_state", [
  "STOPPED",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "ERROR",
  "RISK_HALTED",
  "DISCONNECTED",
]);
export const licenseStatus = pgEnum("license_status", [
  "active",
  "suspended",
  "expired",
  "revoked",
]);
export const positionSide = pgEnum("position_side", ["buy", "sell"]);
export const secretKind = pgEnum("secret_kind", [
  "mt5_trading_password",
  "mt5_investor_password",
  "broker_api_key",
]);
export const strategyStatus = pgEnum("strategy_status", ["draft", "active", "deprecated"]);
export const strategyVersionStatus = pgEnum("strategy_version_status", [
  "draft",
  "validated",
  "active",
  "deprecated",
]);
export const tradeEventType = pgEnum("trade_event_type", [
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
]);
export const userStatus = pgEnum("user_status", ["active", "suspended", "pending", "deleted"]);

// Objectifs de gain (§7 du prompt maître) et politique d'arrêt.
export const profitReference = pgEnum("profit_reference", ["session", "day"]);
export const stopPolicy = pgEnum("stop_policy", ["keep_positions", "close_positions"]);

// ------------------------------------------------------------------- utilisateurs

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash"),
    identityProvider: varchar("identity_provider", { length: 64 }),
    displayName: varchar("display_name", { length: 120 }),
    status: userStatus("status").notNull().default("pending"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
    statusIdx: index("users_status_idx").on(t.status),
  }),
);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 48 }).notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
    roleIdx: index("user_roles_role_idx").on(t.roleId),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    fingerprintHash: varchar("fingerprint_hash", { length: 64 }),
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    userIdx: index("sessions_user_idx").on(t.userId),
    expiresIdx: index("sessions_expires_idx").on(t.expiresAt),
  }),
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorKind: varchar("actor_kind", { length: 24 }).notNull().default("user"),
    action: varchar("action", { length: 96 }).notNull(),
    targetType: varchar("target_type", { length: 48 }),
    targetId: varchar("target_id", { length: 64 }),
    requestId: varchar("request_id", { length: 64 }),
    result: varchar("result", { length: 24 }).notNull().default("success"),
    metadata: jsonb("metadata").notNull().default({}),
    ipHash: varchar("ip_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index("audit_events_actor_idx").on(t.actorUserId, t.createdAt),
    requestIdx: index("audit_events_request_idx").on(t.requestId),
    actionIdx: index("audit_events_action_idx").on(t.action),
  }),
);

// ------------------------------------------------------------------ comptes MT5

export const secretRecords = pgTable(
  "secret_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: secretKind("kind").notNull().default("mt5_trading_password"),
    vaultReference: text("vault_reference"),
    ciphertext: text("ciphertext").notNull(),
    nonce: varchar("nonce", { length: 32 }).notNull(),
    keyVersion: integer("key_version").notNull(),
    algorithm: varchar("algorithm", { length: 32 }).notNull().default("aes-256-gcm"),
    encryptedAt: timestamp("encrypted_at", { withTimezone: true }).notNull().defaultNow(),
    rotatesAt: date("rotates_at"),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index("secret_records_owner_idx").on(t.ownerUserId),
    keyVersionIdx: index("secret_records_key_version_idx").on(t.keyVersion),
  }),
);

export const tradingAccounts = pgTable(
  "trading_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    broker: varchar("broker", { length: 120 }).notNull(),
    server: varchar("server", { length: 120 }).notNull(),
    login: varchar("login", { length: 32 }).notNull(),
    secretRecordId: uuid("secret_record_id").references(() => secretRecords.id, {
      onDelete: "set null",
    }),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    environment: accountEnvironment("environment").notNull().default("demo"),
    status: accountStatus("status").notNull().default("unverified"),
    realModeApprovedAt: timestamp("real_mode_approved_at", { withTimezone: true }),
    realModeApprovedBy: uuid("real_mode_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestResult: text("last_test_result"),
    // Dernier instantané confirmé par le moteur (§14 : afficher l'heure de la donnée).
    lastBalance: text("last_balance"),
    lastEquity: text("last_equity"),
    lastMarginLevel: text("last_margin_level"),
    lastCurrency: varchar("last_currency", { length: 8 }),
    lastSnapshotAt: timestamp("last_snapshot_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerServerLoginUnique: uniqueIndex("trading_accounts_owner_server_login_unique").on(
      t.ownerUserId,
      t.server,
      t.login,
    ),
    ownerIdx: index("trading_accounts_owner_idx").on(t.ownerUserId),
    statusIdx: index("trading_accounts_status_idx").on(t.status),
  }),
);

export const connectionTests = pgTable(
  "connection_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tradingAccountId: uuid("trading_account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    engineId: varchar("engine_id", { length: 64 }),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    resultCode: varchar("result_code", { length: 48 }),
    resultMessage: text("result_message"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    pendingIdx: index("connection_tests_pending_idx").on(t.status, t.requestedAt),
    accountIdx: index("connection_tests_account_idx").on(t.tradingAccountId),
  }),
);

// -------------------------------------------------------------------- stratégies

export const strategies = pgTable(
  "strategies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull(),
    status: strategyStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ slugUnique: uniqueIndex("strategies_slug_unique").on(t.slug) }),
);

export const strategyVersions = pgTable(
  "strategy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    version: varchar("version", { length: 32 }).notNull(),
    parameterSchema: jsonb("parameter_schema").notNull(),
    supportedSymbols: jsonb("supported_symbols").notNull(),
    symbolAliases: jsonb("symbol_aliases").notNull().default({}),
    riskConstraints: jsonb("risk_constraints").notNull(),
    martingaleAllowed: boolean("martingale_allowed").notNull().default(false),
    artifactDigest: varchar("artifact_digest", { length: 128 }).notNull(),
    status: strategyVersionStatus("status").notNull().default("draft"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionUnique: uniqueIndex("strategy_versions_strategy_version_unique").on(
      t.strategyId,
      t.version,
    ),
    statusIdx: index("strategy_versions_status_idx").on(t.status),
  }),
);

// ---------------------------------------------------------------------- risques

export const riskProfiles = pgTable(
  "risk_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    policyVersion: integer("policy_version").notNull().default(1),
    maxDailyLoss: text("max_daily_loss").notNull(),
    maxDrawdownPct: text("max_drawdown_pct").notNull(),
    maxOpenPositions: integer("max_open_positions").notNull(),
    maxTotalExposure: text("max_total_exposure").notNull(),
    maxSpreadPoints: integer("max_spread_points").notNull(),
    minMarginLevelPct: text("min_margin_level_pct").notNull(),
    maxRiskPerTradePct: text("max_risk_per_trade_pct").notNull(),
    maxLotSize: text("max_lot_size").notNull(),
    forbidLotIncreaseAfterLoss: boolean("forbid_lot_increase_after_loss")
      .notNull()
      .default(true),
    limits: jsonb("limits").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index("risk_profiles_owner_idx").on(t.ownerUserId),
    ownerNameUnique: uniqueIndex("risk_profiles_owner_name_unique").on(t.ownerUserId, t.name),
  }),
);

// -------------------------------------------------------------------- instances §9

export const instances = pgTable(
  "instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tradingAccountId: uuid("trading_account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "restrict" }),
    strategyVersionId: uuid("strategy_version_id")
      .notNull()
      .references(() => strategyVersions.id, { onDelete: "restrict" }),
    riskProfileId: uuid("risk_profile_id")
      .notNull()
      .references(() => riskProfiles.id, { onDelete: "restrict" }),
    licenseId: uuid("license_id").references(() => licenses.id, { onDelete: "set null" }),
    symbols: jsonb("symbols").notNull(),
    parameters: jsonb("parameters").notNull(),
    artifactDigest: varchar("artifact_digest", { length: 128 }),
    mode: instanceMode("mode").notNull().default("simulation"),
    realAuthorizedAt: timestamp("real_authorized_at", { withTimezone: true }),
    realAuthorizedBy: uuid("real_authorized_by").references(() => users.id, {
      onDelete: "set null",
    }),
    state: instanceState("state").notNull().default("STOPPED"),
    engineConfirmedState: instanceState("engine_confirmed_state").notNull().default("STOPPED"),
    lastEngineSeenAt: timestamp("last_engine_seen_at", { withTimezone: true }),
    stopReason: text("stop_reason"),
    // Suspendu : plus aucune nouvelle entrée, positions existantes conservées.
    newEntriesBlocked: boolean("new_entries_blocked").notNull().default(false),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    // Identifiant stable envoyé au broker (magic number), unique par robot.
    magicNumber: integer("magic_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index("instances_owner_idx").on(t.ownerUserId),
    accountIdx: index("instances_account_idx").on(t.tradingAccountId),
    stateIdx: index("instances_state_idx").on(t.state),
    engineStateIdx: index("instances_engine_state_idx").on(t.engineConfirmedState),
    magicUnique: uniqueIndex("instances_magic_number_unique").on(t.magicNumber),
  }),
);

/**
 * Paramètres éditables d'un robot (§5 du prompt maître).
 *
 * Séparés de `instances` pour que chaque modification soit versionnée par
 * `updated_at` sans réécrire la ligne d'orchestration.
 */
export const robotSettings = pgTable(
  "robot_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    timeframe: varchar("timeframe", { length: 8 }).notNull().default("M15"),
    initialLot: text("initial_lot").notNull().default("0.01"),
    profitTargetNet: text("profit_target_net").notNull().default("10"),
    maxLossNet: text("max_loss_net").notNull().default("5"),
    profitReference: profitReference("profit_reference").notNull().default("session"),
    maxTrades: integer("max_trades").notNull().default(20),
    maxPositions: integer("max_positions").notNull().default(1),
    maxSpreadPoints: integer("max_spread_points").notNull().default(30),
    allowedHours: jsonb("allowed_hours").notNull().default({ start: 0, end: 24 }),
    strategyParameters: jsonb("strategy_parameters").notNull().default({}),
    stopPolicy: stopPolicy("stop_policy").notNull().default("keep_positions"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    instanceUnique: uniqueIndex("robot_settings_instance_unique").on(t.instanceId),
  }),
);

/** Une exécution = une session de robot, avec la raison et le résultat nets. */
export const robotRuns = pgTable(
  "robot_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startEquity: text("start_equity"),
    endEquity: text("end_equity"),
    netResult: text("net_result"),
    tradesCount: integer("trades_count").notNull().default(0),
    stopReason: text("stop_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    instanceIdx: index("robot_runs_instance_idx").on(t.instanceId, t.startedAt),
  }),
);

export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    metricDate: date("metric_date").notNull(),
    realizedPnl: text("realized_pnl").notNull().default("0"),
    floatingPnl: text("floating_pnl").notNull().default("0"),
    commissions: text("commissions").notNull().default("0"),
    swaps: text("swaps").notNull().default("0"),
    netPnl: text("net_pnl").notNull().default("0"),
    tradesCount: integer("trades_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    instanceDayUnique: uniqueIndex("daily_metrics_instance_day_unique").on(
      t.instanceId,
      t.metricDate,
    ),
  }),
);

// --------------------------------------------------------------- commandes §8.1

export const commands = pgTable(
  "commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    type: commandType("type").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    engineId: varchar("engine_id", { length: 64 }),
    payload: jsonb("payload").notNull().default({}),
    status: commandStatus("status").notNull().default("requested"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastTransitionCode: varchar("last_transition_code", { length: 48 }),
    lastTransitionMessage: text("last_transition_message"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex("commands_idempotency_key_unique").on(t.idempotencyKey),
    pendingIdx: index("commands_pending_idx").on(t.status, t.expiresAt),
    instanceIdx: index("commands_instance_idx").on(t.instanceId),
  }),
);

export const commandAcks = pgTable(
  "command_acks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commandId: uuid("command_id")
      .notNull()
      .references(() => commands.id, { onDelete: "cascade" }),
    engineId: varchar("engine_id", { length: 64 }).notNull(),
    ack: commandStatus("ack").notNull(),
    code: varchar("code", { length: 48 }),
    message: text("message"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ commandIdx: index("command_acks_command_idx").on(t.commandId) }),
);

export const engineHeartbeats = pgTable(
  "engine_heartbeats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engineId: varchar("engine_id", { length: 64 }).notNull(),
    engineVersion: varchar("engine_version", { length: 32 }).notNull(),
    terminalKind: varchar("terminal_kind", { length: 32 }).notNull().default("unknown"),
    state: varchar("state", { length: 32 }).notNull(),
    metrics: jsonb("metrics").notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    engineTimeUnique: uniqueIndex("engine_heartbeats_engine_time_unique").on(
      t.engineId,
      t.lastSeenAt,
    ),
    engineIdx: index("engine_heartbeats_engine_idx").on(t.engineId, t.lastSeenAt),
  }),
);

// ------------------------------------------------------- positions, deals, audit

export const positionsSnapshots = pgTable(
  "positions_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tradingAccountId: uuid("trading_account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id").references(() => instances.id, { onDelete: "set null" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    positionId: varchar("position_id", { length: 64 }).notNull(),
    side: positionSide("side").notNull(),
    volume: text("volume").notNull(),
    openPrice: text("open_price").notNull(),
    currentPrice: text("current_price"),
    profit: text("profit"),
    margin: text("margin"),
    openTime: timestamp("open_time", { withTimezone: true }),
    closeTime: timestamp("close_time", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountTimeIdx: index("positions_snapshots_account_time_idx").on(
      t.tradingAccountId,
      t.observedAt,
    ),
    ownerIdx: index("positions_snapshots_owner_idx").on(t.ownerUserId),
    uniqueObservation: uniqueIndex("positions_snapshots_unique").on(
      t.tradingAccountId,
      t.positionId,
      t.observedAt,
    ),
  }),
);

export const tradeEvents = pgTable(
  "trade_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tradingAccountId: uuid("trading_account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id").references(() => instances.id, { onDelete: "set null" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commandId: uuid("command_id").references(() => commands.id, { onDelete: "set null" }),
    brokerTicket: varchar("broker_ticket", { length: 64 }),
    eventType: tradeEventType("event_type").notNull(),
    symbol: varchar("symbol", { length: 32 }),
    volume: text("volume"),
    price: text("price"),
    result: varchar("result", { length: 64 }),
    retcode: varchar("retcode", { length: 32 }),
    detail: jsonb("detail").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountTimeIdx: index("trade_events_account_time_idx").on(t.tradingAccountId, t.occurredAt),
    instanceTimeIdx: index("trade_events_instance_time_idx").on(t.instanceId, t.occurredAt),
    ownerIdx: index("trade_events_owner_idx").on(t.ownerUserId),
  }),
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    bucket: varchar("bucket", { length: 128 }).notNull(),
    windowStart: bigint("window_start", { mode: "number" }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.bucket, t.windowStart] }) }),
);

// ------------------------------------------------------- licences (hors périmètre UI)

export const licenses = pgTable(
  "licenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: licenseStatus("status").notNull().default("active"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxAccounts: integer("max_accounts").notNull().default(1),
    maxInstances: integer("max_instances").notNull().default(1),
    graceHours: smallint("grace_hours").notNull().default(6),
    limits: jsonb("limits").notNull().default({}),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerStatusIdx: index("licenses_owner_status_idx").on(t.ownerUserId, t.status),
    expiresIdx: index("licenses_expires_idx").on(t.expiresAt),
  }),
);

export const licenseEntitlements = pgTable(
  "license_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    licenseId: uuid("license_id")
      .notNull()
      .references(() => licenses.id, { onDelete: "cascade" }),
    strategyVersionId: uuid("strategy_version_id").references(() => strategyVersions.id, {
      onDelete: "cascade",
    }),
    strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "cascade" }),
    maxInstances: integer("max_instances"),
    allowsRealMode: boolean("allows_real_mode").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    licenseIdx: index("license_entitlements_license_idx").on(t.licenseId),
    uniqueEntitlement: uniqueIndex("license_entitlements_unique").on(
      t.licenseId,
      t.strategyVersionId,
      t.strategyId,
    ),
  }),
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    licenseId: uuid("license_id").references(() => licenses.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 48 }).notNull(),
    externalReference: varchar("external_reference", { length: 128 }).notNull(),
    amount: text("amount").notNull(),
    currency: varchar("currency", { length: 8 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerRefUnique: uniqueIndex("payments_provider_ref_unique").on(
      t.provider,
      t.externalReference,
    ),
    ownerIdx: index("payments_owner_idx").on(t.ownerUserId),
  }),
);
