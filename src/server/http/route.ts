/**
 * Utilitaires communs aux Route Handlers.
 */

import { randomUUID } from "node:crypto";

import { errorResponse } from "./api";
import { clientIp } from "./api";
import { hashIp } from "@/server/security/tokens";

export async function withApi(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return errorResponse(error);
  }
}

export function idempotencyKey(request: Request): string {
  const header = request.headers.get("x-idempotency-key")?.trim();
  if (header && header.length >= 8 && header.length <= 128) return header;
  // Repli : une requête sans clé reste utilisable, mais ne peut pas être
  // rejouée à l'identique. L'interface en envoie toujours une.
  return randomUUID();
}

export function requestMeta(request: Request): { ipHash: string | null; idempotencyKey: string } {
  const ip = clientIp(request);
  return {
    ipHash: hashIp(ip, process.env.AUTH_SECRET || ""),
    idempotencyKey: idempotencyKey(request),
  };
}
