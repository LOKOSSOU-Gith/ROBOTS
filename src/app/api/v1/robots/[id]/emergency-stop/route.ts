/**
 * POST /api/v1/robots/{id}/emergency-stop — liquidation distincte de l'arrêt
 * standard, avec confirmation côté serveur (§7.2).
 */

import { requireMutation } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { requestMeta, withApi } from "@/server/http/route";
import { emergencyCloseRobot } from "@/server/services/robots";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    const { id } = await params;
    const result = await emergencyCloseRobot(user.id, id, requestMeta(request));
    return dataResponse(result, 202);
  });
}
