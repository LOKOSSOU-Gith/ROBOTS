/**
 * GET / POST /api/v1/accounts — comptes MT5 du propriétaire (§5, §8).
 */

import { requireMutation, requireUser } from "@/server/auth/session";
import { dataResponse, readJson } from "@/server/http/api";
import { requestMeta, withApi } from "@/server/http/route";
import { createAccount, listAccounts } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    return dataResponse({ accounts: await listAccounts(user.id) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    const body = await readJson(request);
    const account = await createAccount(user.id, body, { ipHash: requestMeta(request).ipHash });
    return dataResponse({ account }, 201);
  });
}
