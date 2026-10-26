/**
 * Limitation de débit persistante (§8).
 *
 * Le compteur vit en base pour être partagé entre instances serverless et
 * survivre à un redémarrage. Une fenêtre fixe suffit pour la connexion et les
 * commandes ; elle n'est pas un mécanisme anti-DDoS (rôle du reverse proxy).
 */

import { sql } from "drizzle-orm";

import type { Database } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  count: number;
}

export function windowStart(now: Date, windowSeconds: number): number {
  return Math.floor(now.getTime() / 1000 / windowSeconds) * windowSeconds;
}

export async function consumeRateLimit(
  db: Database,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const start = windowStart(now, windowSeconds);
  const rows = await db
    .insert(rateLimits)
    .values({ bucket, windowStart: start, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [rateLimits.bucket, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1`, updatedAt: now },
    })
    .returning({ count: rateLimits.count });

  const count = rows[0]?.count ?? 1;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, start + windowSeconds - Math.floor(now.getTime() / 1000)),
    count,
  };
}

/** Purge des fenêtres anciennes : appelée par la tâche de maintenance. */
export async function purgeRateLimits(db: Database, olderThan: Date): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.windowStart} < ${Math.floor(olderThan.getTime() / 1000)}`);
}
