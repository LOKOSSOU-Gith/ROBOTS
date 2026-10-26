/**
 * POST /api/v1/engine/heartbeat — présence, états confirmés et instantanés.
 */

import { z } from "zod";

import { dataResponse, readJson } from "@/server/http/api";
import { assertEngineRequest } from "@/server/http/engineAuth";
import { withApi } from "@/server/http/route";
import { recordHeartbeat } from "@/server/services/engine";

export const dynamic = "force-dynamic";

const schema = z.object({
  engine_version: z.string().max(32),
  terminal_kind: z.string().max(32),
  state: z.string().max(32),
  broker_connected: z.boolean().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  instance_states: z
    .array(z.object({ instance_id: z.string().uuid(), state: z.string().max(32) }))
    .optional(),
  accounts: z
    .array(
      z.object({
        account_id: z.string().uuid(),
        equity: z.string().optional(),
        balance: z.string().optional(),
        margin_level_pct: z.string().optional(),
        currency: z.string().max(8).optional(),
        observed_at: z.string().optional(),
      }),
    )
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { engineId } = assertEngineRequest(request);
    const body = schema.parse(await readJson(request));
    return dataResponse(await recordHeartbeat(engineId, body));
  });
}
