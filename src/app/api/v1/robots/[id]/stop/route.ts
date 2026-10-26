/**
 * POST /api/v1/robots/{id}/stop — arrêt des nouvelles entrées et de la
 * stratégie selon la politique configurée pour les positions existantes (§7.2).
 */

import { requireMutation } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { requestMeta, withApi } from "@/server/http/route";
import { stopRobot } from "@/server/services/robots";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    const { id } = await params;
    const result = await stopRobot(user.id, id, requestMeta(request));
    return dataResponse(result, result.alreadyInState ? 200 : 202);
  });
}
