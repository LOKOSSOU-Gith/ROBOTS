/**
 * Sécurité — hachage, chiffrement au repos, jetons, masquage.
 *
 * Ces tests couvrent les garanties qui ne dépendent pas de la base : aucun
 * secret en clair, aucune comparaison non constante, aucune IP brute.
 */

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertPasswordPolicy,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  PasswordPolicyError,
  verifyPassword,
} from "@/server/security/password";
import { pick, redact, redactValue } from "@/server/security/redact";
import {
  SecretBox,
  SecretConfigurationError,
  type EncryptedSecret,
} from "@/server/security/secrets";
import {
  constantTimeEqual,
  hashIp,
  hmacHex,
  maskLogin,
  randomToken,
  sha256Hex,
} from "@/server/security/tokens";

const key = () => randomBytes(32).toString("base64");
const env = (ring: string): NodeJS.ProcessEnv =>
  ({ NODE_ENV: "test", ENCRYPTION_KEY_RING: ring }) as NodeJS.ProcessEnv;

describe("mot de passe administrateur", () => {
  it("refuse les mots de passe faibles", () => {
    expect(() => assertPasswordPolicy("court1A")).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("minuscule12345")).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("MAJUSCULE12345")).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("SansChiffreUniquement")).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy(`${"aA1".repeat(MIN_PASSWORD_LENGTH)}`)).not.toThrow();
  });

  it("hache avec un sel unique et vérifie sans comparaison naïve", async () => {
    const password = "MotDePasseSolide123";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);
    expect(first.startsWith("scrypt$")).toBe(true);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword("MauvaisMotDePasse123", first)).toBe(false);
    expect(await verifyPassword(password, null)).toBe(false);
    expect(await verifyPassword(password, "scrypt$invalide")).toBe(false);
  });
});

describe("chiffrement AES-256-GCM au repos", () => {
  it("chiffre avec un nonce unique et déchiffre à l'identique", () => {
    const box = SecretBox.fromEnvironment(env(JSON.stringify({ "1": key() })));
    const secret = "mot-de-passe-mt5-très-sensible";
    const first = box.encrypt(secret);
    const second = box.encrypt(secret);

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toContain(secret);
    expect(box.decrypt(first)).toBe(secret);
    expect(box.decrypt(second)).toBe(secret);
  });

  it("refuse un texte chiffré altéré", () => {
    const box = SecretBox.fromEnvironment(env(JSON.stringify({ "1": key() })));
    const record = box.encrypt("secret");
    const bytes = Buffer.from(record.ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    const tampered: EncryptedSecret = { ...record, ciphertext: bytes.toString("base64") };
    expect(() => box.decrypt(tampered)).toThrow();
  });

  it("refuse une clé absente de l'anneau", () => {
    const box = SecretBox.fromEnvironment(env(JSON.stringify({ "1": key() })));
    const record = box.encrypt("secret");
    const other = SecretBox.fromEnvironment(env(JSON.stringify({ "2": key() })));
    expect(() => other.decrypt(record)).toThrow(SecretConfigurationError);
  });

  it("rotation : la clé la plus récente chiffre, les anciennes restent lisibles", () => {
    const first = key();
    const second = key();
    const oldBox = SecretBox.fromEnvironment(env(JSON.stringify({ "1": first })));
    const legacy = oldBox.encrypt("ancien secret");

    const rotated = SecretBox.fromEnvironment(
      env(JSON.stringify({ "1": first, "2": second })),
    );
    expect(rotated.latestVersion).toBe(2);
    expect(rotated.decrypt(legacy)).toBe("ancien secret");
    expect(rotated.encrypt("nouveau secret").keyVersion).toBe(2);
  });

  it("refuse une configuration invalide", () => {
    expect(() => SecretBox.fromEnvironment(env(""))).toThrow(SecretConfigurationError);
    expect(() => SecretBox.fromEnvironment(env("pas du json"))).toThrow(
      SecretConfigurationError,
    );
    expect(() => SecretBox.fromEnvironment(env(JSON.stringify({ "1": "trop court" })))).toThrow(
      SecretConfigurationError,
    );
    expect(() => SecretBox.fromEnvironment(env(JSON.stringify({ "0": key() })))).toThrow(
      SecretConfigurationError,
    );
  });
});

describe("jetons et masquage", () => {
  it("génère des jetons opaques non rejouables", () => {
    const first = randomToken(32);
    const second = randomToken(32);
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(sha256Hex(first)).toHaveLength(64);
    expect(sha256Hex(first)).toBe(sha256Hex(first));
    expect(sha256Hex(first)).not.toBe(first);
  });

  it("compare en temps constant, y compris des longueurs différentes", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  it("masque le numéro de compte et l'IP", () => {
    expect(maskLogin("12345678")).toBe("12****78");
    expect(maskLogin("123")).toBe("***");
    expect(maskLogin("1234")).toBe("****");
    const secret = "a".repeat(32);
    const hashed = hashIp("203.0.113.9", secret);
    expect(hashed).toHaveLength(64);
    expect(hashed).not.toContain("203.0.113.9");
    expect(hashIp(null, secret)).toBeNull();
    expect(hmacHex("x", secret)).toBe(hmacHex("x", secret));
  });
});

describe("masquage des journaux", () => {
  it("masque les clés sensibles à toute profondeur", () => {
    const redacted = redactValue({
      password: "secret",
      nested: { authorization: "Bearer abc", token_hash: "abc", ok: 1 },
      login: "compte 12345678",
      list: [{ apiKey: "k" }],
    }) as Record<string, unknown>;

    expect(redacted.password).toBe("[masqué]");
    expect((redacted.nested as Record<string, unknown>).authorization).toBe("[masqué]");
    expect((redacted.nested as Record<string, unknown>).token_hash).toBe("[masqué]");
    expect((redacted.nested as Record<string, unknown>).ok).toBe(1);
    expect(redacted.login).toBe("[masqué]");
    expect((redacted.list as Array<Record<string, unknown>>)[0]!.apiKey).toBe("[masqué]");
  });

  it("conserve les dates lisibles et ne garde que les clés autorisées", () => {
    expect(redact({ at: new Date("2026-01-02T03:04:05Z") })).toEqual({
      at: "2026-01-02T03:04:05.000Z",
    });
    expect(pick({ a: 1, b: 2 }, ["a", "c"])).toEqual({ a: 1 });
  });
});
