/**
 * POST /api/v1/engine/accounts/{id}/secret — remise ponctuelle du mot de passe
 * MT5 au moteur authentifié (§10). L'usage et le nonce sont vérifiés.
 */

import { z } from "zod";

import { dataResponse, readJson } from "@/server/http/api";
import { assertEngineRequest } from "@/server/http/engineAuth";
import { withApi } from "@/server/http/route";
import { revealEngineSecret } from "@/server/services/engine";

export const dynamic = "force-dynamic";

const schema = z.object({
  purpose: z.enum(["connect", "test_connection"]),
  nonce: z.string().min(8).max(64),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const { engineId } = assertEngineRequest(request);
    const { id } = await params;
    const body = schema.parse(await readJson(request));
    return dataResponse(await revealEngineSecret(id, body.purpose, body.nonce, engineId));
  });
}
