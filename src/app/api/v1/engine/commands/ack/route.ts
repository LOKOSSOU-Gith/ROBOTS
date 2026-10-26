/**
 * POST /api/v1/engine/commands/ack — accusé par étape avec état observé.
 */

import { z } from "zod";

import { dataResponse, readJson } from "@/server/http/api";
import { assertEngineRequest } from "@/server/http/engineAuth";
import { withApi } from "@/server/http/route";
import { acknowledgeCommand } from "@/server/services/engine";

export const dynamic = "force-dynamic";

const schema = z.object({
  command_id: z.string().uuid(),
  ack: z.enum(["received", "accepted", "started", "completed", "failed", "rejected"]),
  code: z.string().max(48).optional(),
  message: z.string().max(300).optional(),
  observed_state: z.string().max(32).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { engineId } = assertEngineRequest(request);
    const body = schema.parse(await readJson(request));
    return dataResponse(
      await acknowledgeCommand(engineId, {
        commandId: body.command_id,
        ack: body.ack,
        code: body.code,
        message: body.message,
        observedState: body.observed_state,
        detail: body.detail,
      }),
    );
  });
}
