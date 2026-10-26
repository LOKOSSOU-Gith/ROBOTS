/**
 * POST /api/v1/engine/events — événements, positions et instantané de compte.
 */

import { z } from "zod";

import { dataResponse, readJson } from "@/server/http/api";
import { assertEngineRequest } from "@/server/http/engineAuth";
import { withApi } from "@/server/http/route";
import { ingestEvents } from "@/server/services/engine";

export const dynamic = "force-dynamic";

const eventSchema = z.object({
  event_type: z.string().max(32).optional(),
  symbol: z.string().max(32).optional(),
  volume: z.string().optional(),
  price: z.string().optional(),
  result: z.string().max(64).optional(),
  retcode: z.string().max(32).optional(),
  broker_ticket: z.string().max(64).optional(),
  occurred_at: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

const schema = z.object({
  trading_account_id: z.string().uuid(),
  instance_id: z.string().uuid().nullish(),
  events: z.array(eventSchema).max(200).optional(),
  positions: z
    .array(
      z.object({
        position_id: z.string().max(64),
        symbol: z.string().max(32),
        side: z.string(),
        volume: z.string(),
        open_price: z.string(),
        current_price: z.string().optional(),
        profit: z.string().optional(),
        margin: z.string().optional(),
        observed_at: z.string().optional(),
      }),
    )
    .max(100)
    .optional(),
  account: z
    .object({
      equity: z.string().optional(),
      balance: z.string().optional(),
      margin_level_pct: z.string().optional(),
      currency: z.string().max(8).optional(),
    })
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { engineId } = assertEngineRequest(request);
    const body = schema.parse(await readJson(request));
    return dataResponse(await ingestEvents(body, engineId));
  });
}
