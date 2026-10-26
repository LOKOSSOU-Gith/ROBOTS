/**
 * Chiffrement des mots de passe MT5 au repos (§10).
 *
 * AES-256-GCM avec nonce aléatoire par enregistrement et anneau de clés
 * versionnées. La clé vit dans l'environnement du serveur, jamais dans
 * PostgreSQL : une copie de la base ne suffit donc pas à déchiffrer un secret.
 *
 * Format de l'anneau (`ENCRYPTION_KEY_RING`) :
 *   {"1":"<clé de 32 octets en base64>","2":"<clé suivante>"}
 * La version la plus élevée chiffre ; toutes les versions restent lisibles
 * jusqu'à rotation.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  keyVersion: number;
  algorithm: typeof ALGORITHM;
}

export class SecretConfigurationError extends Error {}

function decodeKey(encoded: string, version: number): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new SecretConfigurationError(
      `ENCRYPTION_KEY_RING: la clé ${version} doit faire 32 octets encodés en base64`,
    );
  }
  return key;
}

export class SecretBox {
  private readonly keys: Map<number, Buffer>;

  constructor(keys: Map<number, Buffer>) {
    if (keys.size === 0) throw new SecretConfigurationError("anneau de clés vide");
    this.keys = keys;
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): SecretBox {
    const raw = env.ENCRYPTION_KEY_RING?.trim();
    if (!raw) {
      throw new SecretConfigurationError("ENCRYPTION_KEY_RING est absente");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SecretConfigurationError("ENCRYPTION_KEY_RING n'est pas un JSON valide");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SecretConfigurationError("ENCRYPTION_KEY_RING doit être un objet {version: clé}");
    }
    const keys = new Map<number, Buffer>();
    for (const [versionRaw, encoded] of Object.entries(parsed as Record<string, unknown>)) {
      const version = Number(versionRaw);
      if (!Number.isInteger(version) || version < 1) {
        throw new SecretConfigurationError(`version de clé invalide: ${versionRaw}`);
      }
      if (typeof encoded !== "string" || !encoded) {
        throw new SecretConfigurationError(`clé ${version} absente`);
      }
      keys.set(version, decodeKey(encoded, version));
    }
    return new SecretBox(keys);
  }

  get latestVersion(): number {
    return Math.max(...this.keys.keys());
  }

  encrypt(plaintext: string): EncryptedSecret {
    const version = this.latestVersion;
    const key = this.keys.get(version);
    if (!key) throw new SecretConfigurationError(`clé ${version} introuvable`);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([encrypted, tag]).toString("base64"),
      nonce: nonce.toString("base64"),
      keyVersion: version,
      algorithm: ALGORITHM,
    };
  }

  decrypt(record: EncryptedSecret): string {
    if (record.algorithm !== ALGORITHM) {
      throw new SecretConfigurationError("algorithme de chiffrement non supporté");
    }
    const key = this.keys.get(record.keyVersion);
    if (!key) {
      throw new SecretConfigurationError(
        `clé ${record.keyVersion} absente de l'anneau : secret illisible`,
      );
    }
    const payload = Buffer.from(record.ciphertext, "base64");
    if (payload.length <= TAG_BYTES) throw new Error("secret chiffré tronqué");
    const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);
    const tag = payload.subarray(payload.length - TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.nonce, "base64"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}
