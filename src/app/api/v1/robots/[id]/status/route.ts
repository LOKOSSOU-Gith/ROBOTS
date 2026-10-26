/**
 * GET /api/v1/robots/{id}/status — état confirmé, fraîcheur et commandes.
 */

import { requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { robotStatus } from "@/server/services/robots";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    return dataResponse({ status: await robotStatus(user.id, id) });
  });
}
