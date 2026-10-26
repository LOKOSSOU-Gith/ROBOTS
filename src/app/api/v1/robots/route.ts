/**
 * GET /api/v1/robots — les quatre robots du propriétaire, état confirmé.
 */

import { requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { listRobots } from "@/server/services/robots";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    return dataResponse({ robots: await listRobots(user.id) });
  });
}
