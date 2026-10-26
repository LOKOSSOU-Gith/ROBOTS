/**
 * GET /api/v1/accounts/{id}/positions — positions ouvertes confirmées.
 */

import { requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { latestPositions } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    return dataResponse({ positions: await latestPositions(user.id, id) });
  });
}
