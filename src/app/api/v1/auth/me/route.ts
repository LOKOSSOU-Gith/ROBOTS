/**
 * GET /api/v1/auth/me — profil et permissions de la session courante (§8).
 */

import { requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    return dataResponse({ user });
  });
}
