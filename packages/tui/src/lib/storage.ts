import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

// Storage path: ~/.abbacchio/tui-config.json
const DATA_DIR = join(homedir(), '.abbacchio');
const CONFIG_PATH = join(DATA_DIR, 'tui-config.json');

/**
 * Channel configuration
 */
export interface ChannelConfig {
  name: string;
  secretKey: string;
  createdAt: number;
  lastUsedAt: number;
}

interface StorageData {
  channels: ChannelConfig[];
}

let cache: StorageData | null = null;

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load storage data from file
 */
function loadStorage(): StorageData {
  if (cache) return cache;

  ensureDataDir();

  if (!existsSync(CONFIG_PATH)) {
    cache = { channels: [] };
    return cache;
  }

  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    cache = JSON.parse(content) as StorageData;
    return cache;
  } catch {
    cache = { channels: [] };
    return cache;
  }
}

/**
 * Save storage data to file
 */
function saveStorage(data: StorageData): void {
  ensureDataDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
  cache = data;
}

// ============== Channel Operations ==============

/**
 * Get all channels sorted by last used
 */
export function getChannels(): ChannelConfig[] {
  const data = loadStorage();
  return [...data.channels].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/**
 * Get a channel by name
 */
export function getChannel(name: string): ChannelConfig | null {
  const data = loadStorage();
  return data.channels.find(ch => ch.name === name) || null;
}

/**
 * Add or update a channel
 */
export function upsertChannel(name: string, secretKey: string = ''): ChannelConfig {
  const data = loadStorage();
  const now = Date.now();

  const existing = data.channels.find(ch => ch.name === name);

  if (existing) {
    existing.secretKey = secretKey;
    existing.lastUsedAt = now;
  } else {
    data.channels.push({
      name,
      secretKey,
      createdAt: now,
      lastUsedAt: now,
    });
  }

  saveStorage(data);
  return getChannel(name)!;
}

/**
 * Update channel's secret key
 */
export function updateChannelKey(name: string, secretKey: string): void {
  const data = loadStorage();
  const channel = data.channels.find(ch => ch.name === name);

  if (channel) {
    channel.secretKey = secretKey;
    channel.lastUsedAt = Date.now();
    saveStorage(data);
  } else {
    // Create channel if it doesn't exist
    upsertChannel(name, secretKey);
  }
}

/**
 * Update channel's last used timestamp
 */
export function touchChannel(name: string): void {
  const data = loadStorage();
  const channel = data.channels.find(ch => ch.name === name);

  if (channel) {
    channel.lastUsedAt = Date.now();
    saveStorage(data);
  }
}

/**
 * Delete a channel
 */
export function deleteChannel(name: string): void {
  const data = loadStorage();
  data.channels = data.channels.filter(ch => ch.name !== name);
  saveStorage(data);
}

/**
 * Clear the cache (useful for testing)
 */
export function clearCache(): void {
  cache = null;
}
