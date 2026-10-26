/**
 * Catalogue de stratégies et profil de risque par défaut (§5, §6, §9).
 *
 * L'initialisation est idempotente : elle peut être appelée au déploiement, au
 * premier compte ou par un test sans dupliquer de lignes.
 */

import { and, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import type { Database } from "@/server/db/client";
import {
  riskProfiles,
  strategies,
  strategyVersions,
} from "@/server/db/schema";
import { STRATEGY_CATALOG, type StrategyDefinition } from "@/server/domain/strategies";

export interface CatalogEntry {
  definition: StrategyDefinition;
  strategyId: string;
  versionId: string;
}

export async function ensureCatalog(db: Database = getDb()): Promise<CatalogEntry[]> {
  const entries: CatalogEntry[] = [];

  for (const definition of STRATEGY_CATALOG) {
    const existing = await db
      .select({ id: strategies.id })
      .from(strategies)
      .where(eq(strategies.slug, definition.slug))
      .limit(1);

    let strategyId = existing[0]?.id;
    if (!strategyId) {
      const inserted = await db
        .insert(strategies)
        .values({
          slug: definition.slug,
          name: definition.name,
          description: definition.description,
          status: "active",
        })
        .returning({ id: strategies.id });
      strategyId = inserted[0]?.id;
    } else {
      await db
        .update(strategies)
        .set({ name: definition.name, description: definition.description, status: "active" })
        .where(eq(strategies.id, strategyId));
    }
    if (!strategyId) throw new Error(`catalogue: stratégie ${definition.slug} non créée`);

    const versionRows = await db
      .select({ id: strategyVersions.id })
      .from(strategyVersions)
      .where(
        and(
          eq(strategyVersions.strategyId, strategyId),
          eq(strategyVersions.version, definition.version),
        ),
      )
      .limit(1);

    const versionValues = {
      strategyId,
      version: definition.version,
      parameterSchema: definition.parameterSchema,
      supportedSymbols: definition.supportedSymbols,
      symbolAliases: {},
      riskConstraints: definition.riskConstraints,
      martingaleAllowed: false,
      artifactDigest: definition.artifactDigest,
      status: definition.versionStatus,
      releasedAt: new Date(),
    } as const;

    let versionId = versionRows[0]?.id;
    if (!versionId) {
      const inserted = await db
        .insert(strategyVersions)
        .values(versionValues)
        .returning({ id: strategyVersions.id });
      versionId = inserted[0]?.id;
    } else {
      await db.update(strategyVersions).set(versionValues).where(eq(strategyVersions.id, versionId));
    }
    if (!versionId) throw new Error(`catalogue: version ${definition.slug} non créée`);

    entries.push({ definition, strategyId, versionId });
  }

  return entries;
}

export async function ensureDefaultRiskProfile(
  userId: string,
  db: Database = getDb(),
): Promise<string> {
  const existing = await db
    .select({ id: riskProfiles.id })
    .from(riskProfiles)
    .where(and(eq(riskProfiles.ownerUserId, userId), eq(riskProfiles.name, "Profil par défaut")))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(riskProfiles)
    .values({
      ownerUserId: userId,
      name: "Profil par défaut",
      maxDailyLoss: "20",
      maxDrawdownPct: "10",
      maxOpenPositions: 2,
      maxTotalExposure: "20000",
      maxSpreadPoints: 40,
      minMarginLevelPct: "200",
      maxRiskPerTradePct: "0.5",
      maxLotSize: "0.10",
      forbidLotIncreaseAfterLoss: true,
    })
    .returning({ id: riskProfiles.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("profil de risque non créé");
  return id;
}
