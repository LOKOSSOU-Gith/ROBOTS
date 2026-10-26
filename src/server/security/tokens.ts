/**
 * Jetons opaques et masquage (§8, §10).
 *
 * Le jeton de session n'est jamais stocké en clair : la base ne reçoit que son
 * SHA-256. Un vol de la base ne permet donc pas de rejouer une session.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacHex(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Numéro de compte jamais affiché en entier (§8). */
export function maskLogin(login: string): string {
  if (login.length <= 4) return "*".repeat(login.length);
  return `${login.slice(0, 2)}${"*".repeat(Math.max(2, login.length - 4))}${login.slice(-2)}`;
}

/** Adresse IP pseudonymisée pour l'audit : jamais l'IP brute. */
export function hashIp(ip: string | null, secret: string): string | null {
  if (!ip) return null;
  return hmacHex(ip, secret);
}
