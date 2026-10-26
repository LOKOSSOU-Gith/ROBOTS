/**
 * GET /api/v1/robots/{id}/events — derniers ordres, deals et événements.
 */

import { requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { listTradeHistory } from "@/server/services/history";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    return dataResponse({ events: await listTradeHistory(user.id, { robotId: id, limit: 100 }) });
  });
}
