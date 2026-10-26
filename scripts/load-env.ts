/**
 * Charge `.env.local` puis `.env` sans écraser les variables déjà définies.
 * Next.js fait cela tout seul pour l'application ; les scripts CLI en ont
 * besoin pour partager la même configuration.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadEnv(cwd = process.cwd()): void {
  for (const filename of [".env.local", ".env"]) {
    const file = path.join(cwd, filename);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
