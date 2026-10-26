/**
 * POST /api/v1/accounts/{id}/approve-real — double confirmation du mode réel
 * (§7, §8, §14). Refusé pour un compte démo et si des robots tournent.
 */

import { z } from "zod";

import { requireMutation } from "@/server/auth/session";
import { dataResponse, readJson } from "@/server/http/api";
import { requestMeta, withApi } from "@/server/http/route";
import { approveRealMode } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

const schema = z.object({ confirmation: z.string() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    const { id } = await params;
    const body = schema.parse(await readJson(request));
    const account = await approveRealMode(user.id, id, body.confirmation, {
      ipHash: requestMeta(request).ipHash,
    });
    return dataResponse({ account });
  });
}
