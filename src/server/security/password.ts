/**
 * Hachage des mots de passe administrateur (§8).
 *
 * scrypt est fourni par Node : aucune dépendance native supplémentaire, et les
 * paramètres sont inscrits dans l'empreinte pour permettre une migration
 * ultérieure sans invalider les sessions existantes.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

function scrypt(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 12;

export class PasswordPolicyError extends Error {}

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
    );
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new PasswordPolicyError(
      "Le mot de passe doit contenir une minuscule, une majuscule et un chiffre",
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64 ?? "", "base64");
    const expected = Buffer.from(hashB64 ?? "", "base64");
    if (salt.length === 0 || expected.length === 0) return false;
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
