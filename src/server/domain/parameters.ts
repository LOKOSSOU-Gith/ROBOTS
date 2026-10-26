/**
 * Validation des paramètres de stratégie, miroir de
 * `engine/src/mt5_engine/parameters.py`. Le backend refuse exactement ce que
 * le moteur refusera (§8.1).
 */

export type ParameterField =
  | { type: "number"; min: number; max: number; step?: number; default: number; label?: string }
  | { type: "integer"; min: number; max: number; default: number; label?: string }
  | { type: "boolean"; default: boolean; label?: string }
  | { type: "enum"; options: string[]; default: string; label?: string };

export type ParameterSchema = Record<string, ParameterField>;

export type ParameterIssueCode =
  | "unknown_key"
  | "out_of_range"
  | "wrong_type"
  | "not_in_options"
  | "bad_step";

export interface ParameterIssue {
  key: string;
  code: ParameterIssueCode;
  limit?: number;
}

export interface ParameterValidation {
  ok: boolean;
  issues: ParameterIssue[];
  values: Record<string, unknown>;
}

export function validateParameters(
  schema: ParameterSchema,
  incoming: unknown,
): ParameterValidation {
  const issues: ParameterIssue[] = [];
  const values: Record<string, unknown> = {};

  if (incoming !== undefined && incoming !== null && typeof incoming !== "object") {
    return { ok: false, issues: [{ key: "_", code: "wrong_type" }], values: {} };
  }
  const provided = (incoming ?? {}) as Record<string, unknown>;

  for (const [key, field] of Object.entries(schema)) {
    if (!(key in provided)) {
      values[key] = field.default;
      continue;
    }
    const value = provided[key];

    if (field.type === "number") {
      if (typeof value !== "number" || Number.isNaN(value)) {
        issues.push({ key, code: "wrong_type" });
        continue;
      }
      if (value < field.min || value > field.max) {
        issues.push({
          key,
          code: "out_of_range",
          limit: value < field.min ? field.min : field.max,
        });
        continue;
      }
      if (field.step && Math.abs(value / field.step - Math.round(value / field.step)) > 1e-9) {
        issues.push({ key, code: "bad_step", limit: field.step });
        continue;
      }
      values[key] = value;
      continue;
    }

    if (field.type === "integer") {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        issues.push({ key, code: "wrong_type" });
        continue;
      }
      if (value < field.min || value > field.max) {
        issues.push({
          key,
          code: "out_of_range",
          limit: value < field.min ? field.min : field.max,
        });
        continue;
      }
      values[key] = value;
      continue;
    }

    if (field.type === "boolean") {
      if (typeof value !== "boolean") {
        issues.push({ key, code: "wrong_type" });
        continue;
      }
      values[key] = value;
      continue;
    }

    if (typeof value !== "string" || !field.options.includes(value)) {
      issues.push({ key, code: "not_in_options" });
      continue;
    }
    values[key] = value;
  }

  for (const key of Object.keys(provided)) {
    if (!(key in schema)) issues.push({ key, code: "unknown_key" });
  }

  return { ok: issues.length === 0, issues, values };
}

/**
 * FNV-1a 64 bits sur la représentation canonique (clés triées, séparateurs
 * compacts) : identique au calcul Python de `parameters_digest`.
 */
export function parametersDigest(values: Record<string, unknown>): string {
  const canonical = canonicalJson(values);
  let hash = 0xcbf29ce484222325n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** JSON canonique : clés triées, mêmes séparateurs que Python. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
