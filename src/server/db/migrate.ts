/**
 * Application des migrations Drizzle (§9).
 *
 * À exécuter avec `DATABASE_URL_DIRECT` (hors pooler), dans un processus
 * contrôlé et avant le déploiement du backend.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../drizzle",
);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL_DIRECT ou DATABASE_URL est requis");
  }

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
    console.log("migrations appliquées");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("échec de migration:", error instanceof Error ? error.message : error);
  process.exit(1);
});
