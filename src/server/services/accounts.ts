/**
 * Comptes MT5 (§5, §9, §10).
 *
 * Le mot de passe traverse cette couche une seule fois, est chiffré
 * immédiatement et n'est jamais renvoyé à l'interface. Le test de connexion est
 * exécuté par le moteur, seul processus capable de parler au terminal.
 */

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import type { Database } from "@/server/db/client";
import {
  connectionTests,
  instances,
  positionsSnapshots,
  riskProfiles,
  robotSettings,
  secretRecords,
  strategyVersions,
  tradingAccounts,
} from "@/server/db/schema";
import { createAccountSchema, type CreateAccountInput } from "@/server/domain/robotSettings";
import { ApiError, badRequest, conflict, notFound } from "@/server/http/api";
import { SecretBox } from "@/server/security/secrets";
import { maskLogin } from "@/server/security/tokens";
import { recordAudit } from "./audit";
import { ensureCatalog, ensureDefaultRiskProfile } from "./catalog";

export interface AccountView {
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
  lastTestAt: Date | null;
  lastTestResult: string | null;
  realApproved: boolean;
  robotCount: number;
}

function toView(row: typeof tradingAccounts.$inferSelect, robotCount: number): AccountView {
  return {
    id: row.id,
    broker: row.broker,
    server: row.server,
    loginMasked: maskLogin(row.login),
    environment: row.environment,
    status: row.status,
    currency: row.lastCurrency ?? row.currency,
    balance: row.lastBalance,
    equity: row.lastEquity,
    marginLevel: row.lastMarginLevel,
    lastSnapshotAt: row.lastSnapshotAt,
    lastTestAt: row.lastTestAt,
    lastTestResult: row.lastTestResult,
    realApproved: Boolean(row.realModeApprovedAt),
    robotCount,
  };
}

export async function listAccounts(userId: string): Promise<AccountView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.ownerUserId, userId))
    .orderBy(desc(tradingAccounts.createdAt));

  const views: AccountView[] = [];
  for (const row of rows) {
    const counts = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(instances)
      .where(eq(instances.tradingAccountId, row.id));
    views.push(toView(row, counts[0]?.count ?? 0));
  }
  return views;
}

export async function getAccount(userId: string, accountId: string): Promise<AccountView> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.ownerUserId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("Compte MT5 introuvable");
  const counts = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(instances)
    .where(eq(instances.tradingAccountId, row.id));
  return toView(row, counts[0]?.count ?? 0);
}

/** Crée le compte, chiffre le secret et installe les quatre robots. */
export async function createAccount(
  userId: string,
  rawInput: unknown,
  meta: { ipHash?: string | null } = {},
): Promise<AccountView> {
  const input: CreateAccountInput = createAccountSchema.parse(rawInput);
  const db = getDb();

  // Le mode réel exige une activation ultérieure explicite ; la création reste
  // possible pour préparer la configuration, mais aucun démarrage réel n'est
  // autorisé avant `approveRealMode`.
  if (input.environment === "real" && process.env.ALLOW_REAL_ACCOUNTS !== "true") {
    throw badRequest(
      "La création d'un compte réel est désactivée sur cette installation (ALLOW_REAL_ACCOUNTS)",
    );
  }

  const duplicate = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(
      and(
        eq(tradingAccounts.ownerUserId, userId),
        eq(tradingAccounts.server, input.server),
        eq(tradingAccounts.login, input.login),
      ),
    )
    .limit(1);
  if (duplicate[0]) throw conflict("Ce compte est déjà enregistré pour ce serveur");

  const box = SecretBox.fromEnvironment();
  const encrypted = box.encrypt(input.password);

  const account = await db.transaction(async (tx) => {
    const secret = await tx
      .insert(secretRecords)
      .values({
        ownerUserId: userId,
        kind: "mt5_trading_password",
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        keyVersion: encrypted.keyVersion,
        algorithm: encrypted.algorithm,
      })
      .returning({ id: secretRecords.id });

    const created = await tx
      .insert(tradingAccounts)
      .values({
        ownerUserId: userId,
        broker: input.broker,
        server: input.server,
        login: input.login,
        secretRecordId: secret[0]?.id,
        currency: "USD",
        environment: input.environment,
        status: "unverified",
      })
      .returning();
    const row = created[0];
    if (!row) throw new Error("compte non créé");
    return row;
  });

  await ensureRobotsForAccount(userId, account.id);
  await recordAudit({
    actorUserId: userId,
    action: "account.created",
    targetType: "trading_account",
    targetId: account.id,
    metadata: {
      environment: input.environment,
      server: input.server,
      login: maskLogin(input.login),
    },
    ipHash: meta.ipHash,
  });

  return getAccount(userId, account.id);
}

/** Les quatre robots sont créés une seule fois par compte. */
export async function ensureRobotsForAccount(
  userId: string,
  accountId: string,
  db: Database = getDb(),
): Promise<void> {
  const accountRows = await db
    .select()
    .from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.ownerUserId, userId)))
    .limit(1);
  const account = accountRows[0];
  if (!account) throw notFound("Compte MT5 introuvable");

  const catalog = await ensureCatalog(db);
  const riskProfileId = await ensureDefaultRiskProfile(userId, db);

  const existing = await db
    .select({ strategyVersionId: instances.strategyVersionId })
    .from(instances)
    .where(
      and(eq(instances.ownerUserId, userId), eq(instances.tradingAccountId, accountId)),
    );
  const existingVersions = new Set(existing.map((row) => row.strategyVersionId));

  for (const entry of catalog) {
    if (existingVersions.has(entry.versionId)) continue;

    const magicRows = await db
      .select({ max: sql<number | null>`max(${instances.magicNumber})` })
      .from(instances);
    const magic = (magicRows[0]?.max ?? 740_000) + 1;

    const inserted = await db
      .insert(instances)
      .values({
        ownerUserId: userId,
        tradingAccountId: accountId,
        strategyVersionId: entry.versionId,
        riskProfileId,
        symbols: [entry.definition.supportedSymbols[0] ?? "XAUUSD"],
        parameters: Object.fromEntries(
          Object.entries(entry.definition.parameterSchema).map(([key, field]) => [
            key,
            field.default,
          ]),
        ),
        artifactDigest: entry.definition.artifactDigest,
        mode: account.environment === "real" ? "real" : "demo",
        magicNumber: magic,
      })
      .returning({ id: instances.id });

    const instanceId = inserted[0]?.id;
    if (!instanceId) throw new Error("robot non créé");

    await db.insert(robotSettings).values({
      instanceId,
      symbol: entry.definition.supportedSymbols[0] ?? "XAUUSD",
      timeframe: "M15",
      initialLot: "0.01",
      profitTargetNet: "10",
      maxLossNet: "5",
      profitReference: "session",
      maxTrades: 20,
      maxPositions: 1,
      maxSpreadPoints: 30,
      allowedHours: { start: 0, end: 24 },
      strategyParameters: Object.fromEntries(
        Object.entries(entry.definition.parameterSchema).map(([key, field]) => [
          key,
          field.default,
        ]),
      ),
      stopPolicy: "keep_positions",
    });
  }
}

export async function requestConnectionTest(
  userId: string,
  accountId: string,
): Promise<{ testId: string; status: string }> {
  const db = getDb();
  await getAccount(userId, accountId);
  const rows = await db
    .insert(connectionTests)
    .values({
      tradingAccountId: accountId,
      ownerUserId: userId,
      requestedBy: userId,
      status: "pending",
    })
    .returning({ id: connectionTests.id, status: connectionTests.status });
  const row = rows[0];
  if (!row) throw new Error("test de connexion non créé");
  await recordAudit({
    actorUserId: userId,
    action: "account.connection_test_requested",
    targetType: "trading_account",
    targetId: accountId,
  });
  return { testId: row.id, status: row.status };
}

export async function getConnectionTest(userId: string, accountId: string, testId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(connectionTests)
    .where(
      and(
        eq(connectionTests.id, testId),
        eq(connectionTests.tradingAccountId, accountId),
        eq(connectionTests.ownerUserId, userId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("Test de connexion introuvable");
  return row;
}

export async function approveRealMode(
  userId: string,
  accountId: string,
  confirmation: string,
  meta: { ipHash?: string | null } = {},
): Promise<AccountView> {
  if (confirmation !== "MODE RÉEL") {
    throw badRequest('Confirmation explicite requise : "MODE RÉEL"');
  }
  const db = getDb();
  const account = await getAccount(userId, accountId);
  if (account.environment !== "real") {
    throw badRequest("Ce compte est un compte de démonstration");
  }
  if (account.status !== "connected") {
    throw badRequest("La connexion doit être testée avec succès avant toute activation réelle");
  }

  const live = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(instances)
    .where(
      and(
        eq(instances.tradingAccountId, accountId),
        ne(instances.state, "STOPPED"),
      ),
    );
  if ((live[0]?.count ?? 0) > 0) {
    throw conflict("Arrêtez tous les robots avant d'activer le mode réel");
  }

  await db
    .update(tradingAccounts)
    .set({ realModeApprovedAt: new Date(), realModeApprovedBy: userId, updatedAt: new Date() })
    .where(eq(tradingAccounts.id, accountId));
  await db
    .update(instances)
    .set({ realAuthorizedAt: new Date(), realAuthorizedBy: userId, updatedAt: new Date() })
    .where(eq(instances.tradingAccountId, accountId));

  await recordAudit({
    actorUserId: userId,
    action: "account.real_mode_approved",
    targetType: "trading_account",
    targetId: accountId,
    metadata: { confirmation: true },
    ipHash: meta.ipHash,
  });
  return getAccount(userId, accountId);
}

export async function deleteAccount(userId: string, accountId: string): Promise<void> {
  const db = getDb();
  await getAccount(userId, accountId);
  const live = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(instances)
    .where(and(eq(instances.tradingAccountId, accountId), ne(instances.state, "STOPPED")));
  if ((live[0]?.count ?? 0) > 0) {
    throw conflict("Arrêtez les robots avant de supprimer ce compte");
  }
  // Les robots et secrets sont supprimés en cascade ; les événements aussi.
  await db.delete(tradingAccounts).where(eq(tradingAccounts.id, accountId));
  await recordAudit({
    actorUserId: userId,
    action: "account.deleted",
    targetType: "trading_account",
    targetId: accountId,
  });
}

export async function revealAccountSecret(accountId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({
      ciphertext: secretRecords.ciphertext,
      nonce: secretRecords.nonce,
      keyVersion: secretRecords.keyVersion,
      algorithm: secretRecords.algorithm,
      revokedAt: secretRecords.revokedAt,
    })
    .from(secretRecords)
    .innerJoin(tradingAccounts, eq(tradingAccounts.secretRecordId, secretRecords.id))
    .where(eq(tradingAccounts.id, accountId))
    .limit(1);
  const row = rows[0];
  if (!row || row.revokedAt) throw notFound("Secret MT5 introuvable ou révoqué");
  return SecretBox.fromEnvironment().decrypt({
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    keyVersion: row.keyVersion,
    algorithm: "aes-256-gcm",
  });
}

export async function latestPositions(userId: string, accountId?: string) {
  const db = getDb();
  const filters = [
    eq(positionsSnapshots.ownerUserId, userId),
    isNull(positionsSnapshots.closeTime),
  ];
  if (accountId) filters.push(eq(positionsSnapshots.tradingAccountId, accountId));
  const rows = await db
    .select()
    .from(positionsSnapshots)
    .where(and(...filters))
    .orderBy(desc(positionsSnapshots.observedAt))
    .limit(200);

  // Une seule ligne par position : la plus récente.
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.positionId)) return false;
    seen.add(row.positionId);
    return true;
  });
}

export async function defaultRiskProfileId(userId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ id: riskProfiles.id })
    .from(riskProfiles)
    .where(eq(riskProfiles.ownerUserId, userId))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) return ensureDefaultRiskProfile(userId, db);
  return id;
}

export async function strategyVersionFor(versionId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.id, versionId))
    .limit(1);
  return rows[0] ?? null;
}

export function assertAccountAccessError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  throw new ApiError(500, "account_service_error", "Erreur du service de compte");
}


export async function latestConnectionTest(userId: string, accountId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(connectionTests)
    .where(
      and(
        eq(connectionTests.tradingAccountId, accountId),
        eq(connectionTests.ownerUserId, userId),
      ),
    )
    .orderBy(desc(connectionTests.requestedAt))
    .limit(1);
  return rows[0] ?? null;
}
