/**
 * Masquage des secrets dans tout ce qui est journalisé (§8, §10).
 *
 * La fonction est appliquée au moment d'écrire le journal, pas au moment de
 * construire l'objet : un champ sensible ajouté par erreur en amont reste
 * masqué.
 */

const SENSITIVE_MARKERS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "apikey",
  "api_key",
  "ciphertext",
  "nonce",
  "cookie",
  "credential",
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return SENSITIVE_MARKERS.some((marker) => normalized.includes(marker.replace("_", "")));
}

const ACCOUNT_RE = /\b(login|account|compte)\b[^\w]{0,3}\d{4,16}/gi;

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? "[masqué]" : redactValue(inner);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.replace(ACCOUNT_RE, "[masqué]");
  }
  return value;
}

export function redact<T>(value: T): T {
  return redactValue(value) as T;
}

/** Ne conserve que les clés explicitement autorisées (listes blanches). */
export function pick<T extends Record<string, unknown>>(value: T, keys: readonly string[]): Partial<T> {
  return Object.fromEntries(
    keys.filter((key) => key in value).map((key) => [key, value[key]]),
  ) as Partial<T>;
}
