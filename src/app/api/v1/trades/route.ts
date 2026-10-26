/**
 * GET /api/v1/trades — historique filtrable par robot et période.
 */

import { requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { listTradeHistory } from "@/server/services/history";

export const dynamic = "force-dynamic";

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const robotId = url.searchParams.get("robotId") ?? undefined;
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));
    const limit = Number(url.searchParams.get("limit") ?? 200);
    return dataResponse({
      trades: await listTradeHistory(user.id, {
        robotId,
        from,
        to,
        limit: Number.isFinite(limit) ? limit : 200,
      }),
    });
  });
}
