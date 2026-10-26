/**
 * GET /api/v1/robots/{id}/metrics — résultat net par jour et totaux.
 */

import { requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { robotDailyMetrics } from "@/server/services/history";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    return dataResponse(await robotDailyMetrics(user.id, id));
  });
}
