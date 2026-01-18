import { createDecipheriv, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive a key from a password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
}

/**
 * Decrypt data encrypted with AES-256-GCM
 * Expects base64 encoded string: salt + iv + authTag + ciphertext
 */
export function decrypt(encryptedData: string, secretKey: string): string {
  const combined = Buffer.from(encryptedData, 'base64');

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

  return decrypted.toString('utf8');
}

/**
 * Decrypt an encrypted log entry
 */
export function decryptLog<T = unknown>(encryptedLog: { encrypted: string }, secretKey: string): T {
  const jsonStr = decrypt(encryptedLog.encrypted, secretKey);
  return JSON.parse(jsonStr);
}

/**
 * Try to decrypt, return null on failure
 */
export function tryDecrypt(encryptedData: string, secretKey: string): string | null {
  try {
    return decrypt(encryptedData, secretKey);
  } catch {
    return null;
  }
}
