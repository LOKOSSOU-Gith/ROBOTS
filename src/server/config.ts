/**
 * Validation de la configuration serveur (§8, §10).
 *
 * Un démarrage sans secret de session ou sans clé de chiffrement doit échouer
 * explicitement plutôt que dégrader silencieusement la sécurité.
 */

import { SecretBox } from "./security/secrets";

export class ConfigurationError extends Error {}

export function assertServerConfig(): void {
  const missing: string[] = [];
  const database = process.env.DATABASE_URL;
  const authSecret = process.env.AUTH_SECRET;
  const keyRing = process.env.ENCRYPTION_KEY_RING;

  if (!database) missing.push("DATABASE_URL");
  if (!authSecret || authSecret.length < 32) missing.push("AUTH_SECRET (32 caractères minimum)");
  if (!keyRing) missing.push("ENCRYPTION_KEY_RING");

  const allowed = process.env.ALLOWED_ORIGINS;
  if (!allowed) missing.push("ALLOWED_ORIGINS");

  if (missing.length > 0) {
    throw new ConfigurationError(
      `Configuration serveur incomplète : ${missing.join(", ")}. Voir .env.example.`,
    );
  }

  // Valide la structure de l'anneau sans exposer les clés.
  SecretBox.fromEnvironment();
}
