/**
 * Browser-compatible AES-256-GCM encryption/decryption
 * Uses Web Crypto API with PBKDF2 key derivation
 *
 * Wire format: base64(salt + iv + authTag + ciphertext)
 * - salt: 32 bytes (for PBKDF2 key derivation)
 * - iv: 16 bytes (initialization vector)
 * - authTag: 16 bytes (GCM authentication tag)
 * - ciphertext: variable length
 */

const ALGORITHM = 'AES-GCM';
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive a key from password using PBKDF2
 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  usage: 'encrypt' | 'decrypt'
): Promise<CryptoKey> {
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
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: ALGORITHM, length: 256 },
    false,
    [usage]
  );
}

/**
 * Encrypt data using AES-256-GCM with PBKDF2 key derivation
 * @param data - The string data to encrypt
 * @param secretKey - The encryption password/key
 * @returns Base64-encoded encrypted data
 */
export async function encrypt(data: string, secretKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const key = await deriveKey(secretKey, salt, 'encrypt');

  // Web Crypto AES-GCM encrypt returns ciphertext with authTag appended
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(data)
  );

  const encryptedArray = new Uint8Array(encrypted);

  // Split ciphertext and authTag (tag is last 16 bytes)
  const ciphertext = encryptedArray.slice(0, -AUTH_TAG_LENGTH);
  const authTag = encryptedArray.slice(-AUTH_TAG_LENGTH);

  // Combine in wire format: salt + iv + authTag + ciphertext
  const combined = new Uint8Array(
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + ciphertext.length
  );
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(authTag, SALT_LENGTH + IV_LENGTH);
  combined.set(ciphertext, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  // Convert to base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data that was encrypted with the encrypt function
 * @param encryptedData - Base64-encoded encrypted data
 * @param secretKey - The encryption password/key
 * @returns Decrypted string
 */
export async function decrypt(encryptedData: string, secretKey: string): Promise<string> {
  // Decode base64
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

  // Extract components
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
  const key = await deriveKey(secretKey, salt, 'decrypt');

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Check if Web Crypto API is available
 */
export function isCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

/**
 * Generate a random encryption key
 * @param length - Length in bytes (default: 32)
 * @returns Base64url-encoded random key
 */
export function generateKey(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // Convert to base64url (URL-safe base64)
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
