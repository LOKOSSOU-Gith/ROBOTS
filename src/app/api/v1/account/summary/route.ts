/**
 * GET /api/v1/account/summary — dernier instantané de compte confirmé.
 */

import { requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { accountSummary } from "@/server/services/dashboard";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    return dataResponse({ summary: await accountSummary(user.id) });
  });
}
