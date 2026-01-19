import { EventEmitter } from 'events';
import { getIdPool } from './id-pool.js';
import { LOG_LEVELS, type IncomingLog, type IncomingLogOrEncrypted, type EncryptedLog, type LogEntry, type LogLevelLabel } from '../types.js';
import { publish as centrifugoPublish } from './centrifugo-client.js';

/** Default channel name when none is specified */
export const DEFAULT_CHANNEL = 'default';

/** Known fields to extract from incoming logs (avoid object spread overhead) */
const KNOWN_FIELDS = new Set(['level', 'time', 'msg', 'message', 'namespace', 'name', 'channel']);

export interface ChannelInfo {
  name: string;
  createdAt: number;
  lastActivity: number;
  logCount: number;
}

export interface LogBufferConfig {
  maxChannels: number;
  channelTtl: number; // ms - remove inactive channels after this time
}

const DEFAULT_CONFIG: LogBufferConfig = {
  maxChannels: parseInt(process.env.MAX_CHANNELS || '10000', 10),
  channelTtl: parseInt(process.env.CHANNEL_TTL || '86400000', 10), // 24 hours
};

/**
 * Check if a log is encrypted
 */
function isEncryptedLog(log: IncomingLogOrEncrypted): log is EncryptedLog {
  return 'encrypted' in log && typeof log.encrypted === 'string';
}

/**
 * Extract data fields from incoming log (avoiding object spread)
 */
function extractDataFields(incoming: IncomingLog): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(incoming)) {
    if (!KNOWN_FIELDS.has(key)) {
      data[key] = incoming[key];
    }
  }
  return data;
}

/**
 * Log buffer for managing channels and publishing logs to Centrifugo
 * No storage - logs are only streamed in real-time via Centrifugo
 * Supports multiple channels (apps)
 *
 * Events emitted:
 * - 'channel:added': (channel: string) - new channel registered
 * - 'clear': (channel?: string) - logs cleared
 */
export class LogBuffer extends EventEmitter {
  private channels: Map<string, ChannelInfo> = new Map();
  private config: LogBufferConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<LogBufferConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize default channel
    this.channels.set(DEFAULT_CHANNEL, {
      name: DEFAULT_CHANNEL,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      logCount: 0,
    });
  }

  /**
   * Start cleanup interval for expired channels
   */
  startCleanupInterval(): void {
    if (this.cleanupInterval) return;

    // Check every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredChannels();
    }, 3600000);
  }

  /**
   * Stop cleanup interval
   */
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clean up channels that have been inactive beyond TTL
   */
  cleanupExpiredChannels(): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const [name, info] of this.channels) {
      // Never remove default channel
      if (name === DEFAULT_CHANNEL) continue;

      if (now - info.lastActivity > this.config.channelTtl) {
        this.channels.delete(name);
        expired.push(name);
      }
    }

    return expired;
  }

  /**
   * Normalize an incoming log to a standard format
   * Optimized to avoid object spread and minimize allocations
   * If the log contains a 'channel' property, it overrides the default channel
   */
  private normalizeLog(incoming: IncomingLog, defaultChannel: string): LogEntry {
    const level = typeof incoming.level === 'number' ? incoming.level : 30;
    const levelLabel = (LOG_LEVELS[level as keyof typeof LOG_LEVELS] || 'info') as LogLevelLabel;
    const channel = incoming.channel || defaultChannel;

    return {
      id: getIdPool().getId(),
      level,
      levelLabel,
      time: incoming.time || Date.now(),
      msg: incoming.msg || incoming.message || '',
      namespace: incoming.namespace || incoming.name,
      channel,
      data: extractDataFields(incoming),
    };
  }

  /**
   * Create an encrypted log entry (server stores encrypted blob, client decrypts)
   */
  private createEncryptedEntry(encryptedLog: EncryptedLog, channel: string): LogEntry {
    return {
      id: getIdPool().getId(),
      level: 30, // Default level for display (actual level is encrypted)
      levelLabel: 'info',
      time: Date.now(),
      msg: '[Encrypted]',
      channel,
      encrypted: true,
      encryptedData: encryptedLog.encrypted,
      data: {},
    };
  }

  /**
   * Process incoming log (plain or encrypted)
   */
  private processLog(incoming: IncomingLogOrEncrypted, channel: string): LogEntry {
    if (isEncryptedLog(incoming)) {
      return this.createEncryptedEntry(incoming, channel);
    }
    return this.normalizeLog(incoming, channel);
  }

  /**
   * Register a channel (with LRU-style eviction if at limit)
   */
  private registerChannel(channel: string): void {
    const existing = this.channels.get(channel);

    if (existing) {
      // Update last activity
      existing.lastActivity = Date.now();
      return;
    }

    // Check if we need to evict oldest channel
    if (this.channels.size >= this.config.maxChannels) {
      this.evictOldestChannel();
    }

    const now = Date.now();
    this.channels.set(channel, {
      name: channel,
      createdAt: now,
      lastActivity: now,
      logCount: 0,
    });

    this.emit('channel:added', channel);
  }

  /**
   * Evict the oldest (least recently active) channel
   */
  private evictOldestChannel(): void {
    let oldestChannel: string | null = null;
    let oldestTime = Infinity;

    for (const [name, info] of this.channels) {
      // Never evict default channel
      if (name === DEFAULT_CHANNEL) continue;

      if (info.lastActivity < oldestTime) {
        oldestTime = info.lastActivity;
        oldestChannel = name;
      }
    }

    if (oldestChannel) {
      this.channels.delete(oldestChannel);
    }
  }

  /**
   * Add a single log entry (broadcasts only, no storage)
   * Publishes to Centrifugo for real-time distribution
   * If the log contains a 'channel' property, it overrides the default channel
   */
  add(incoming: IncomingLogOrEncrypted, defaultChannel: string = DEFAULT_CHANNEL): LogEntry {
    const entry = this.processLog(incoming, defaultChannel);
    const channel = entry.channel;

    this.registerChannel(channel);

    // Update channel stats
    const channelInfo = this.channels.get(channel);
    if (channelInfo) {
      channelInfo.logCount++;
      channelInfo.lastActivity = Date.now();
    }

    // Publish to Centrifugo (async, non-blocking)
    centrifugoPublish(`logs:${channel}`, { type: 'log', data: entry }).catch((err) => {
      console.error('[Centrifugo] Failed to publish log:', err.message);
    });

    return entry;
  }

  /**
   * Add multiple log entries (broadcasts only, no storage)
   * Publishes to Centrifugo for real-time distribution
   * Logs are grouped by channel - each log can specify its own channel
   */
  addBatch(logs: IncomingLogOrEncrypted[], defaultChannel: string = DEFAULT_CHANNEL): LogEntry[] {
    // Group logs by channel for correct publishing
    const logsByChannel = new Map<string, LogEntry[]>();

    for (const log of logs) {
      const entry = this.processLog(log, defaultChannel);
      const channel = entry.channel;

      this.registerChannel(channel);

      if (!logsByChannel.has(channel)) {
        logsByChannel.set(channel, []);
      }
      logsByChannel.get(channel)!.push(entry);
    }

    const allEntries: LogEntry[] = [];

    // Publish each group to its corresponding channel
    for (const [channel, entries] of logsByChannel) {
      allEntries.push(...entries);

      // Update channel stats
      const channelInfo = this.channels.get(channel);
      if (channelInfo) {
        channelInfo.logCount += entries.length;
        channelInfo.lastActivity = Date.now();
      }

      // Publish to Centrifugo (async, non-blocking)
      centrifugoPublish(`logs:${channel}`, { type: 'batch', data: entries }).catch((err) => {
        console.error('[Centrifugo] Failed to publish batch:', err.message);
      });
    }

    return allEntries;
  }

  /**
   * Get all logs (always empty - no storage)
   */
  getAll(_channel?: string): LogEntry[] {
    return [];
  }

  /**
   * Get all registered channels
   */
  getChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Get channel info
   */
  getChannelInfo(channel: string): ChannelInfo | undefined {
    return this.channels.get(channel);
  }

  /**
   * Get all channel info
   */
  getAllChannelInfo(): ChannelInfo[] {
    return Array.from(this.channels.values());
  }

  /**
   * Clear channels (no logs to clear - no storage)
   */
  clear(channel?: string): void {
    if (!channel) {
      this.channels.clear();
      this.channels.set(DEFAULT_CHANNEL, {
        name: DEFAULT_CHANNEL,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        logCount: 0,
      });
    } else {
      const info = this.channels.get(channel);
      if (info) {
        info.logCount = 0;
      }
    }
    this.emit('clear', channel);
  }

  /**
   * Get buffer size (always 0 - no storage)
   */
  getSize(_channel?: string): number {
    return 0;
  }

  /**
   * Get buffer size (always 0 - no storage)
   */
  get size(): number {
    return 0;
  }

  /**
   * Get number of registered channels
   */
  get channelCount(): number {
    return this.channels.size;
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    channelCount: number;
    maxChannels: number;
    channels: ChannelInfo[];
  } {
    return {
      channelCount: this.channels.size,
      maxChannels: this.config.maxChannels,
      channels: this.getAllChannelInfo(),
    };
  }
}

// Singleton instance
let instance: LogBuffer | null = null;

export function getLogBuffer(): LogBuffer {
  if (!instance) {
    instance = new LogBuffer();
    instance.startCleanupInterval();
  }
  return instance;
}

export function resetLogBuffer(): void {
  if (instance) {
    instance.stopCleanupInterval();
    instance.removeAllListeners();
  }
  instance = null;
}
