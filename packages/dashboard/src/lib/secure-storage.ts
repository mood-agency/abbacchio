/**
 * Secure Storage Module
 * Encrypts channel configurations (including secret keys) with a master password
 * Uses AES-256-GCM with PBKDF2 key derivation
 */

const STORAGE_KEY = 'abbacchio-channels-encrypted';
const SALT_STORAGE_KEY = 'abbacchio-channels-salt';
const SESSION_PASSWORD_KEY = 'abbacchio-master-password-session';
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100000;

export interface SecureChannelConfig {
  id: string;
  name: string;
  secretKey: string;
}

export interface SecureStorageResult {
  success: boolean;
  error?: string;
}

/**
 * Generate a random salt for key derivation
 */
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Generate a random IV for encryption
 */
function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH));
}

/**
 * Derive an encryption key from password using PBKDF2
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
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-256-GCM
 */
async function encryptData(data: string, password: string): Promise<{ encrypted: string; salt: string }> {
  const encoder = new TextEncoder();
  const salt = generateSalt();
  const iv = generateIV();
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(data)
  );

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return {
    encrypted: btoa(String.fromCharCode(...combined)),
    salt: btoa(String.fromCharCode(...salt)),
  };
}

/**
 * Decrypt data with AES-256-GCM
 */
async function decryptData(encryptedData: string, password: string, saltBase64: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));

  const iv = new Uint8Array(combined.buffer, combined.byteOffset, IV_LENGTH);
  const ciphertext = new Uint8Array(combined.buffer, combined.byteOffset + IV_LENGTH);

  const key = await deriveKey(password, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Check if encrypted storage exists
 */
export function hasEncryptedStorage(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/**
 * Save channels encrypted with master password
 */
export async function saveSecureChannels(
  channels: SecureChannelConfig[],
  password: string
): Promise<SecureStorageResult> {
  try {
    const data = JSON.stringify(channels);
    const { encrypted, salt } = await encryptData(data, password);

    localStorage.setItem(STORAGE_KEY, encrypted);
    localStorage.setItem(SALT_STORAGE_KEY, salt);

    return { success: true };
  } catch (e) {
    console.error('[SecureStorage] Failed to save channels:', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to encrypt data'
    };
  }
}

/**
 * Load and decrypt channels with master password
 */
export async function loadSecureChannels(
  password: string
): Promise<{ channels: SecureChannelConfig[] | null; error?: string }> {
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY);
    const salt = localStorage.getItem(SALT_STORAGE_KEY);

    if (!encrypted || !salt) {
      return { channels: [] };
    }

    const data = await decryptData(encrypted, password, salt);
    const channels = JSON.parse(data) as SecureChannelConfig[];

    return { channels };
  } catch (e) {
    // Decryption failed - likely wrong password
    console.error('[SecureStorage] Failed to load channels:', e);
    return {
      channels: null,
      error: 'Invalid password or corrupted data'
    };
  }
}

/**
 * Verify if password is correct by attempting decryption
 */
export async function verifyPassword(password: string): Promise<boolean> {
  const result = await loadSecureChannels(password);
  return result.channels !== null;
}

/**
 * Clear all secure storage
 */
export function clearSecureStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SALT_STORAGE_KEY);
}

/**
 * Change master password - decrypt with old, encrypt with new
 */
export async function changeMasterPassword(
  oldPassword: string,
  newPassword: string
): Promise<SecureStorageResult> {
  try {
    const { channels, error } = await loadSecureChannels(oldPassword);

    if (error || channels === null) {
      return { success: false, error: error || 'Failed to decrypt with old password' };
    }

    return saveSecureChannels(channels, newPassword);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to change password'
    };
  }
}

/**
 * Save master password to session storage
 * Password is only kept for the duration of the browser session
 */
export function savePasswordToSession(password: string): void {
  sessionStorage.setItem(SESSION_PASSWORD_KEY, password);
}

/**
 * Get master password from session storage
 */
export function getPasswordFromSession(): string | null {
  return sessionStorage.getItem(SESSION_PASSWORD_KEY);
}

/**
 * Check if master password is saved in session storage
 */
export function hasPasswordInSession(): boolean {
  return sessionStorage.getItem(SESSION_PASSWORD_KEY) !== null;
}

/**
 * Clear master password from session storage
 */
export function clearPasswordFromSession(): void {
  sessionStorage.removeItem(SESSION_PASSWORD_KEY);
}
