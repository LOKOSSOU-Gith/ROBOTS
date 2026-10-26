/**
 * POST /api/v1/auth/logout — révocation serveur de la session (§8).
 */

import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  requireMutation,
  revokeSessionById,
} from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { recordAudit } from "@/server/services/audit";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    const { currentSession } = await import("@/server/auth/session");
    const session = await currentSession();
    if (session) await revokeSessionById(session.sessionId);
    await recordAudit({
      actorUserId: user.id,
      action: "auth.logout",
    });
    const response = dataResponse({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    response.cookies.delete(CSRF_COOKIE);
    return response;
  });
}
