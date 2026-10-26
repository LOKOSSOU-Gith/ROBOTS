/**
 * POST /api/v1/emergency-stop — arrêt d'urgence global (§7).
 *
 * La confirmation est un texte exact, vérifié côté serveur. Chaque robot actif
 * reçoit une commande de liquidation distincte et idempotente.
 */

import { z } from "zod";

import { requireMutation } from "@/server/auth/session";
import { dataResponse, readJson } from "@/server/http/api";
import { requestMeta, withApi } from "@/server/http/route";
import { emergencyStopAll } from "@/server/services/robots";

export const dynamic = "force-dynamic";

const schema = z.object({ confirmation: z.literal("ARRÊT D'URGENCE") });

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    schema.parse(await readJson(request));
    const meta = requestMeta(request);
    const result = await emergencyStopAll(user.id, meta);
    return dataResponse(result, 202);
  });
}
