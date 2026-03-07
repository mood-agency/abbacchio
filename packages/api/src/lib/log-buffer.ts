import { EventEmitter } from 'events';
import { getIdPool } from './id-pool.js';
import { LOG_LEVELS, type IncomingLog, type IncomingLogOrEncrypted, type EncryptedLog, type LogEntry, type LogLevelLabel } from '../types.js';

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
  maxLogsPerChannel: number;
}

const DEFAULT_CONFIG: LogBufferConfig = {
  maxChannels: parseInt(process.env.MAX_CHANNELS || '10000', 10),
  channelTtl: parseInt(process.env.CHANNEL_TTL || '86400000', 10), // 24 hours
  maxLogsPerChannel: parseInt(process.env.MAX_LOGS_PER_CHANNEL || '5000', 10),
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
 * Log buffer for managing channels and storing logs in memory.
 * Supports polling via getAll() and getSince() for dashboard consumption.
 *
 * Events emitted:
 * - 'channel:added': (channel: string) - new channel registered
 * - 'clear': (channel?: string) - logs cleared
 */
export class LogBuffer extends EventEmitter {
  private channels: Map<string, ChannelInfo> = new Map();
  private logs: Map<string, LogEntry[]> = new Map();
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
    this.logs.set(DEFAULT_CHANNEL, []);
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
        this.logs.delete(name);
        expired.push(name);
      }
    }

    return expired;
  }

  /**
   * Normalize an incoming log to a standard format
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
      traceId: incoming.traceId,
      spanId: incoming.spanId,
      data: extractDataFields(incoming),
    };
  }

  /**
   * Create an encrypted log entry
   */
  private createEncryptedEntry(encryptedLog: EncryptedLog, channel: string): LogEntry {
    return {
      id: getIdPool().getId(),
      level: 30,
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
      existing.lastActivity = Date.now();
      return;
    }

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
    this.logs.set(channel, []);

    this.emit('channel:added', channel);
  }

  /**
   * Evict the oldest (least recently active) channel
   */
  private evictOldestChannel(): void {
    let oldestChannel: string | null = null;
    let oldestTime = Infinity;

    for (const [name, info] of this.channels) {
      if (name === DEFAULT_CHANNEL) continue;

      if (info.lastActivity < oldestTime) {
        oldestTime = info.lastActivity;
        oldestChannel = name;
      }
    }

    if (oldestChannel) {
      this.channels.delete(oldestChannel);
      this.logs.delete(oldestChannel);
    }
  }

  /**
   * Store a log entry in the channel's ring buffer
   */
  private storeLog(entry: LogEntry, channel: string): void {
    let channelLogs = this.logs.get(channel);
    if (!channelLogs) {
      channelLogs = [];
      this.logs.set(channel, channelLogs);
    }
    channelLogs.push(entry);

    // Ring buffer: drop oldest when over limit
    if (channelLogs.length > this.config.maxLogsPerChannel) {
      channelLogs.splice(0, channelLogs.length - this.config.maxLogsPerChannel);
    }
  }

  /**
   * Add a single log entry
   */
  add(incoming: IncomingLogOrEncrypted, defaultChannel: string = DEFAULT_CHANNEL): LogEntry {
    const entry = this.processLog(incoming, defaultChannel);
    const channel = entry.channel;

    this.registerChannel(channel);

    const channelInfo = this.channels.get(channel);
    if (channelInfo) {
      channelInfo.logCount++;
      channelInfo.lastActivity = Date.now();
    }

    this.storeLog(entry, channel);

    return entry;
  }

  /**
   * Add multiple log entries
   */
  addBatch(logs: IncomingLogOrEncrypted[], defaultChannel: string = DEFAULT_CHANNEL): LogEntry[] {
    const allEntries: LogEntry[] = [];

    for (const log of logs) {
      const entry = this.processLog(log, defaultChannel);
      const channel = entry.channel;

      this.registerChannel(channel);

      const channelInfo = this.channels.get(channel);
      if (channelInfo) {
        channelInfo.logCount++;
        channelInfo.lastActivity = Date.now();
      }

      this.storeLog(entry, channel);
      allEntries.push(entry);
    }

    return allEntries;
  }

  /**
   * Get all logs for a channel (or all channels)
   */
  getAll(channel?: string): LogEntry[] {
    if (channel) {
      return this.logs.get(channel) || [];
    }
    // Return all logs across all channels
    const all: LogEntry[] = [];
    for (const entries of this.logs.values()) {
      all.push(...entries);
    }
    // Sort by time
    all.sort((a, b) => a.time - b.time);
    return all;
  }

  /**
   * Get logs newer than a given ID (for polling)
   */
  getSince(afterId: string, channel?: string): LogEntry[] {
    const allLogs = this.getAll(channel);
    const idx = allLogs.findIndex(l => l.id === afterId);
    if (idx === -1) return allLogs; // ID not found, return all
    return allLogs.slice(idx + 1);
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
   * Clear logs
   */
  clear(channel?: string): void {
    if (!channel) {
      this.channels.clear();
      this.logs.clear();
      this.channels.set(DEFAULT_CHANNEL, {
        name: DEFAULT_CHANNEL,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        logCount: 0,
      });
      this.logs.set(DEFAULT_CHANNEL, []);
    } else {
      const info = this.channels.get(channel);
      if (info) {
        info.logCount = 0;
      }
      this.logs.set(channel, []);
    }
    this.emit('clear', channel);
  }

  /**
   * Get buffer size
   */
  getSize(channel?: string): number {
    if (channel) {
      return (this.logs.get(channel) || []).length;
    }
    let total = 0;
    for (const entries of this.logs.values()) {
      total += entries.length;
    }
    return total;
  }

  /**
   * Get buffer size
   */
  get size(): number {
    return this.getSize();
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
