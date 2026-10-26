/**
 * Amorçage idempotent : catalogue des quatre stratégies, rôle administrateur,
 * profil de risque et robots des comptes existants.
 *
 * Aucun identifiant par défaut : ADMIN_EMAIL et ADMIN_PASSWORD sont exigés
 * pour créer le premier compte. Un mot de passe n'est jamais journalisé.
 *
 * Usage : npm run db:seed
 */

import { eq } from "drizzle-orm";

import { loadEnv } from "./load-env";
import { getDb } from "../src/server/db/client";
import { roles, userRoles, users } from "../src/server/db/schema";
import { hashPassword, assertPasswordPolicy } from "../src/server/security/password";
import { ensureCatalog, ensureDefaultRiskProfile } from "../src/server/services/catalog";
import { ensureRobotsForAccount } from "../src/server/services/accounts";
import { tradingAccounts } from "../src/server/db/schema";

async function main(): Promise<void> {
  loadEnv();
  const db = getDb();

  const entries = await ensureCatalog(db);
  console.log(`catalogue: ${entries.length} stratégies initialisées`);

  const roleRows = await db.select().from(roles).where(eq(roles.slug, "admin")).limit(1);
  let roleId = roleRows[0]?.id;
  if (!roleId) {
    const inserted = await db
      .insert(roles)
      .values({ slug: "admin", description: "Administrateur de la plateforme" })
      .returning({ id: roles.id });
    roleId = inserted[0]?.id;
  }
  if (!roleId) throw new Error("rôle admin non créé");

  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email) throw new Error("ADMIN_EMAIL est requis pour amorcer l'administrateur");

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId = existing[0]?.id;

  if (!userId) {
    if (!password) {
      throw new Error(
        "ADMIN_PASSWORD est requis pour créer l'administrateur (12 caractères minimum)",
      );
    }
    assertPasswordPolicy(password);
    const inserted = await db
      .insert(users)
      .values({
        email,
        displayName: "Administrateur",
        passwordHash: await hashPassword(password),
        status: "active",
      })
      .returning({ id: users.id });
    userId = inserted[0]?.id;
    console.log(`administrateur créé: ${email}`);
  } else {
    console.log(`administrateur existant conservé: ${email}`);
  }
  if (!userId) throw new Error("administrateur non créé");

  const link = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .limit(1);
  if (!link[0]) {
    await db.insert(userRoles).values({ userId, roleId });
  }

  const riskProfileId = await ensureDefaultRiskProfile(userId, db);
  console.log(`profil de risque par défaut: ${riskProfileId}`);

  const accounts = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(eq(tradingAccounts.ownerUserId, userId));
  for (const account of accounts) {
    await ensureRobotsForAccount(userId, account.id, db);
  }
  console.log(`comptes: ${accounts.length} · robots vérifiés`);

  console.log("amorçage terminé");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("échec de l'amorçage:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
