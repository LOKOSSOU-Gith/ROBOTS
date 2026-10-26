/**
 * GET / DELETE /api/v1/accounts/{id}.
 */

import { requireMutation, requireUser } from "@/server/auth/session";
import { dataResponse } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { deleteAccount, getAccount } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireUser();
    const { id } = await params;
    return dataResponse({ account: await getAccount(user.id, id) });
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const user = await requireMutation(request);
    const { id } = await params;
    await deleteAccount(user.id, id);
    return dataResponse({ deleted: true });
  });
}
