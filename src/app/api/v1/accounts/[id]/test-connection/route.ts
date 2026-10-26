/**
 * POST /api/v1/accounts/{id}/test-connection — demande exécutée par le moteur.
 * GET  … — dernier résultat connu (y compris en attente).
 */

import { requireMutation, requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { latestConnectionTest, requestConnectionTest } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    const { id } = await params;
    const test = await requestConnectionTest(user.id, id);
    return dataResponse({ test }, 202);
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    const test = await latestConnectionTest(user.id, id);
    return dataResponse({ test });
  });
}
