/**
 * Connexion PostgreSQL unique par processus (§9, §12.2).
 *
 * Le pool est volontairement petit : le VPS dispose de 4 Go de RAM et
 * PostgreSQL est plafonné côté serveur. `prepare: false` permet de traverser
 * un pooler (PgBouncer/Neon) sans casser les requêtes préparées.
 */

import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PgDatabase<any, typeof schema>;

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as {
  __mt5Sql?: Sql;
  __mt5Db?: Database;
};

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL est absente de l'environnement");
  }
  return url;
}

export function createDatabase(url = connectionString(), maxConnections = 5): Database {
  const sql = postgres(url, {
    max: maxConnections,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return drizzle(sql, { schema });
}

/** Connexion paresseuse : un build Next.js ne doit pas exiger la base. */
export function getDb(): Database {
  if (globalForDb.__mt5Db) return globalForDb.__mt5Db;
  const db = createDatabase();
  globalForDb.__mt5Db = db;
  return db;
}

/** Injection réservée aux tests d'intégration (PGlite). */
export function setDbForTests(db: Database | null): void {
  globalForDb.__mt5Db = db ?? undefined;
}

export { schema };
