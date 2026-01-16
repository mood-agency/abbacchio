import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive a key from a password using PBKDF2 (browser-compatible)
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
}

/**
 * Encrypt data with AES-256-GCM
 * Returns base64 encoded string: salt:iv:authTag:ciphertext
 */
export function encrypt(data: string, secretKey: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(secretKey, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Combine: salt + iv + authTag + ciphertext
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypt data encrypted with encrypt()
 */
export function decrypt(encryptedData: string, secretKey: string): string {
  const combined = Buffer.from(encryptedData, "base64");

  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(secretKey, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Encrypt a log object
 */
export function encryptLog(log: unknown, secretKey: string): { encrypted: string } {
  const jsonStr = JSON.stringify(log);
  return { encrypted: encrypt(jsonStr, secretKey) };
}

/**
 * Decrypt an encrypted log
 */
export function decryptLog<T = unknown>(encryptedLog: { encrypted: string }, secretKey: string): T {
  const jsonStr = decrypt(encryptedLog.encrypted, secretKey);
  return JSON.parse(jsonStr);
}
