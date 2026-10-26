/**
 * GET /api/v1/events — journaux fusionnés (commandes, risque, erreurs, audit).
 */

import { requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { listLogs } from "@/server/services/history";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const robotId = url.searchParams.get("robotId") ?? undefined;
    return dataResponse({ events: await listLogs(user.id, robotId) });
  });
}
