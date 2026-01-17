/**
 * Browser-compatible AES-256-GCM decryption
 * Must match the server-side encryption format
 *
 * IMPORTANT: Key Derivation Algorithm Compatibility
 * ================================================
 * The server (transport) uses scrypt for key derivation, which is not available
 * in the Web Crypto API. The browser uses PBKDF2 instead.
 *
 * For encryption to work correctly, the transport must be configured to use
 * browser-compatible key derivation (PBKDF2), not the default scrypt.
 *
 * Both algorithms derive a 256-bit AES key from the password, but they use
 * different derivation functions:
 * - Server (scrypt): More memory-hard, better for server-side
 * - Browser (PBKDF2): Web Crypto API compatible
 *
 * The transport library handles this automatically when used with the dashboard.
 */

const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a key from password using PBKDF2 (browser equivalent of scrypt)
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

/**
 * Decrypt data that was encrypted with the server's encrypt function
 * Note: Server uses scrypt, but we use PBKDF2 for browser compatibility
 * This means you need to use a separate browser-compatible encryption on the server
 */
export async function decrypt(encryptedData: string, secretKey: string): Promise<string> {
  // Decode base64
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

  // Extract components (must match server format)
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.slice(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  // Combine ciphertext and authTag for WebCrypto (it expects them together)
  const ciphertextWithTag = new Uint8Array(ciphertext.length + authTag.length);
  ciphertextWithTag.set(ciphertext);
  ciphertextWithTag.set(authTag, ciphertext.length);

  // Derive key
  const key = await deriveKey(secretKey, salt);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Try to decrypt a log entry
 */
export async function decryptLog<T = unknown>(
  encryptedData: string,
  secretKey: string
): Promise<T | null> {
  try {
    const jsonStr = await decrypt(encryptedData, secretKey);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Check if Web Crypto API is available
 */
export function isCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}
