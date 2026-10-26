/**
 * GET /api/v1/health — état technique minimal (§8).
 *
 * Aucun secret, aucun nom de broker, aucune donnée de compte : cette route est
 * publique et sert au contrôle de santé du reverse proxy.
 */

import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { engineStatus } from "@/server/services/engine";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withApi(async () => {
    let database = false;
    try {
      await getDb().execute(sql`select 1`);
      database = true;
    } catch {
      database = false;
    }
    let engine: { online: boolean; lastSeenAt: Date | null } = {
      online: false,
      lastSeenAt: null,
    };
    if (database) {
      const status = await engineStatus();
      engine = { online: status.online, lastSeenAt: status.lastSeenAt };
    }
    const ok = database;
    return dataResponse(
      {
        status: ok ? "ok" : "degraded",
        database,
        engine,
        checkedAt: new Date().toISOString(),
      },
      ok ? 200 : 503,
    );
  });
}
