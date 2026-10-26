/**
 * POST /api/v1/robots/{id}/start — commande idempotente.
 *
 * Réponse 202 : la commande est enregistrée, pas encore exécutée. Le client
 * doit interroger /status jusqu'à l'état confirmé par le moteur (§8).
 */

import { requireMutation } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { requestMeta, withApi } from "@/server/http/route";
import { startRobot } from "@/server/services/robots";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    const { id } = await params;
    const meta = requestMeta(request);
    const result = await startRobot(user.id, id, meta);
    return dataResponse(result, result.alreadyInState ? 200 : 202);
  });
}
