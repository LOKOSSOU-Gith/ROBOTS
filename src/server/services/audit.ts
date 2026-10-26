/**
 * Journal d'audit (§8, §14).
 *
 * Toute action administrative significative est enregistrée. Les métadonnées
 * ne doivent contenir ni mot de passe, ni jeton, ni secret MT5 : l'appelant
 * passe un objet déjà filtré.
 */

import { desc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import type { Database } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";

export interface AuditInput {
  actorUserId?: string | null;
  actorKind?: "user" | "engine" | "system";
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  result?: "success" | "failure" | "rejected";
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
}

export async function recordAudit(input: AuditInput, db: Database = getDb()): Promise<void> {
  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId ?? null,
    actorKind: input.actorKind ?? "user",
    action: input.action.slice(0, 96),
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    requestId: input.requestId ?? null,
    result: input.result ?? "success",
    metadata: input.metadata ?? {},
    ipHash: input.ipHash ?? null,
  });
}

export async function listAuditEvents(limit = 100, db: Database = getDb()) {
  return db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(limit);
}

export async function auditForTarget(targetId: string, db: Database = getDb()) {
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.targetId, targetId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(50);
}
