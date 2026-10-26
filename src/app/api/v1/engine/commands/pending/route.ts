/**
 * GET /api/v1/engine/commands/pending — réclame la plus ancienne commande.
 *
 * Les commandes expirées sont marquées `expired` ; celles reçues sans accusé
 * depuis 20 s sont redistribuées (le moteur déduplique localement).
 */

import { dataResponse } from "@/server/http/api";
import { assertEngineRequest } from "@/server/http/engineAuth";
import { withApi } from "@/server/http/route";
import { pendingCommand } from "@/server/services/engine";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { engineId } = assertEngineRequest(request);
    return dataResponse(await pendingCommand(engineId));
  });
}
