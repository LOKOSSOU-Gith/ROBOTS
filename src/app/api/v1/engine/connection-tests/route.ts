/**
 * GET  /api/v1/engine/connection-tests — tests en attente.
 * POST /api/v1/engine/connection-tests — résultat d'un test.
 */

import { z } from "zod";

import { dataResponse, readJson } from "@/server/http/api";
import { assertEngineRequest } from "@/server/http/engineAuth";
import { withApi } from "@/server/http/route";
import { acknowledgeConnectionTest, pendingConnectionTests } from "@/server/services/engine";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { engineId } = assertEngineRequest(request);
    return dataResponse(await pendingConnectionTests(engineId));
  });
}

const schema = z.object({
  connection_test_id: z.string().uuid(),
  status: z.enum(["connected", "failed"]),
  code: z.string().max(48).optional(),
  message: z.string().max(300).optional(),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    assertEngineRequest(request);
    const body = schema.parse(await readJson(request));
    return dataResponse(await acknowledgeConnectionTest(body));
  });
}
