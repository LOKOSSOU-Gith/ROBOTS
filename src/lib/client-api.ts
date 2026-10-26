"use client";

/**
 * Appels API depuis le navigateur : jeton CSRF, cookies same-origin et clé
 * d'idempotence sur les mutations.
 */

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)mt5_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function apiFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.method && options.method !== "GET") {
    headers["x-csrf-token"] = csrfToken();
    headers["x-idempotency-key"] = options.idempotencyKey ?? newIdempotencyKey();
  }

  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    credentials: "same-origin",
    cache: "no-store",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  let payload: { data?: T; error?: { code?: string; message?: string } } = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new ApiClientError(
      payload.error?.message ?? "Erreur inattendue",
      payload.error?.code ?? "unknown",
      response.status,
    );
  }
  return payload.data as T;
}

export async function apiFetchWithRetry<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  return apiFetch<T>(path, options);
}
