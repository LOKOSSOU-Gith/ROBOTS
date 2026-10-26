/**
 * Sessions administrateur (§8).
 *
 * - jeton opaque de 32 octets, stocké uniquement sous forme de SHA-256 ;
 * - cookie httpOnly + secure en production, SameSite=Lax ;
 * - jeton CSRF séparé, lisible par le client, comparé à l'en-tête sur toute
 *   mutation ;
 * - révocation immédiate en base à la déconnexion.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { ApiError, forbidden, unauthorized } from "@/server/http/api";
import { constantTimeEqual, hashIp, randomToken, sha256Hex } from "@/server/security/tokens";

export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "mt5_session";
export const CSRF_COOKIE = "mt5_csrf";
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 86_400);

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
}

export interface SessionContext {
  user: CurrentUser;
  sessionId: string;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function createSession(
  userId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const db = getDb();
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const secret = process.env.AUTH_SECRET || "";
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256Hex(token),
    ipHash: hashIp(meta.ip, secret),
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    expiresAt,
  });
  return { token, csrfToken, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<SessionContext | null> {
  if (!token) return null;
  const db = getDb();
  const rows = await db
    .select({
      sessionId: sessions.id,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256Hex(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  return {
    sessionId: row.sessionId,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      status: row.status,
    },
  };
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  const db = getDb();
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeSessionByToken(token: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, sha256Hex(token)));
}

export async function currentSession(): Promise<SessionContext | null> {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<CurrentUser> {
  const session = await currentSession();
  if (!session) throw unauthorized();
  return session.user;
}

/** Garde des pages : redirige vers la connexion plutôt que d'afficher une erreur. */
export async function requirePageUser(): Promise<CurrentUser> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session.user;
}

/**
 * Vérifie l'origine et le jeton CSRF. Les requêtes sans cookie CSRF sont
 * refusées : le middleware en pose un sur toute page servie.
 */
export async function assertCsrf(request: Request): Promise<void> {
  const store = await cookies();
  const cookieToken = store.get(CSRF_COOKIE)?.value ?? "";
  const headerToken = request.headers.get("x-csrf-token") ?? "";
  if (!cookieToken || !headerToken || !constantTimeEqual(cookieToken, headerToken)) {
    throw forbidden("Jeton CSRF absent ou invalide");
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    // Les clients non navigateur (moteur) ne passent pas par cette garde.
    throw forbidden("Origine absente");
  }
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const host = request.headers.get("host");
  const sameHost = host ? [`https://${host}`, `http://${host}`] : [];
  if (![...allowed, ...sameHost].includes(origin)) {
    throw forbidden("Origine non autorisée");
  }
}

export async function requireMutation(request: Request): Promise<CurrentUser> {
  const user = await requireUser();
  await assertCsrf(request);
  return user;
}

export class EngineAuthError extends ApiError {
  constructor() {
    super(401, "engine_unauthorized", "Service moteur non authentifié");
  }
}
