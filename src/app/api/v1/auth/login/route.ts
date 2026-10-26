/**
 * POST /api/v1/auth/login — ouverture de session administrateur (§8).
 *
 * Réponse volontairement identique pour un compte inconnu et un mot de passe
 * erroné : aucune énumération de comptes.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  assertCsrf,
  createSession,
  CSRF_COOKIE,
  csrfCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { ApiError, clientIp, dataResponse, readJson } from "@/server/http/api";
import { withApi } from "@/server/http/route";
import { consumeRateLimit } from "@/server/security/rateLimit";
import { verifyPassword } from "@/server/security/password";
import { hashIp, sha256Hex } from "@/server/security/tokens";
import { recordAudit } from "@/server/services/audit";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(256),
});

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    await assertCsrf(request);
    const input = loginSchema.parse(await readJson(request));
    const db = getDb();
    const secret = process.env.AUTH_SECRET || "";
    const ipHash = hashIp(clientIp(request), secret);

    const ipLimit = await consumeRateLimit(
      db,
      `login:ip:${ipHash ?? "unknown"}`,
      20,
      15 * 60,
    );
    if (!ipLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: { code: "rate_limited", message: "Trop de tentatives, réessayez plus tard" },
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(ipLimit.retryAfterSeconds),
            "cache-control": "no-store",
          },
        },
      );
    }

    const emailLimit = await consumeRateLimit(db, `login:email:${sha256Hex(input.email)}`, 5, 15 * 60);
    if (!emailLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: { code: "rate_limited", message: "Trop de tentatives, réessayez plus tard" },
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(emailLimit.retryAfterSeconds),
            "cache-control": "no-store",
          },
        },
      );
    }

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    const user = rows[0];

    const invalid = () =>
      new ApiError(401, "invalid_credentials", "Identifiants invalides");

    if (!user) {
      await recordAudit({
        action: "auth.login_failed",
        metadata: { reason: "unknown_account" },
        ipHash,
        result: "failure",
      });
      throw invalid();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new ApiError(429, "account_locked", "Compte temporairement verrouillé");
    }
    if (user.status !== "active") {
      throw new ApiError(403, "account_inactive", "Compte non actif");
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      const failures = user.failedLoginCount + 1;
      await db
        .update(users)
        .set({
          failedLoginCount: failures,
          lockedUntil:
            failures >= MAX_FAILED_LOGINS
              ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
              : null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await recordAudit({
        actorUserId: user.id,
        action: "auth.login_failed",
        metadata: { reason: "bad_password", failures },
        ipHash,
        result: "failure",
      });
      throw invalid();
    }

    const session = await createSession(user.id, {
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    await db
      .update(users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await recordAudit({
      actorUserId: user.id,
      action: "auth.login",
      ipHash,
      metadata: { session_issued: true },
    });

    const response = dataResponse({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      expiresAt: session.expiresAt,
    });
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions());
    response.cookies.set(CSRF_COOKIE, session.csrfToken, csrfCookieOptions());
    return response;
  });
}
