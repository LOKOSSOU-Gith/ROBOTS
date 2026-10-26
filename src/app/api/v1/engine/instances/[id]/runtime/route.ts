/**
 * GET /api/v1/engine/instances/{id}/runtime — configuration vérifiée avant
 * tout démarrage (§8.1). `runnable=false` interdit l'exécution.
 */

import { dataResponse } from "@/server/http/api";
import { assertEngineRequest } from "@/server/http/engineAuth";
import { withApi } from "@/server/http/route";
import { getRuntime } from "@/server/services/engine";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    assertEngineRequest(request);
    const { id } = await params;
    return dataResponse(await getRuntime(id));
  });
}
