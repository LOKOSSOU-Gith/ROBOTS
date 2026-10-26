/**
 * Contrat HTTP commun : enveloppe `{ data }` ou `{ error }`, codes stables et
 * aucune fuite de détail interne dans les réponses (§8).
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (message = "Authentification requise") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message = "Accès refusé") => new ApiError(403, "forbidden", message);
export const notFound = (message = "Ressource introuvable") =>
  new ApiError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "conflict", message, details);
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);

export function dataResponse(data: unknown, status = 200): NextResponse {
  return NextResponse.json(
    { data },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_failed",
          message: "Données invalides",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status, headers: { "cache-control": "no-store" } },
    );
  }
  // Aucun message brut : il pourrait contenir une chaîne de connexion ou un secret.
  console.error("erreur API non gérée:", error instanceof Error ? error.name : "unknown");
  return NextResponse.json(
    { error: { code: "internal_error", message: "Erreur interne" } },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Content-Type application/json requis");
  }
  try {
    return await request.json();
  } catch {
    throw badRequest("Corps JSON invalide");
  }
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}
