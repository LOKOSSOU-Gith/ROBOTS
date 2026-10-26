/**
 * GET / PATCH /api/v1/robots/{id} — configuration validée côté serveur.
 */

import { requireMutation, requireUser } from "@/server/auth/session";
import { dataResponse, readJson } from "@/server/http/api";
import { requestMeta, withApi } from "@/server/http/route";
import { getRobot, updateRobotSettings } from "@/server/services/robots";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    return dataResponse({ robot: await getRobot(user.id, id) });
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    const { id } = await params;
    const body = await readJson(request);
    const meta = requestMeta(request);
    const result = await updateRobotSettings(user.id, id, body, meta);
    return dataResponse(result);
  });
}
