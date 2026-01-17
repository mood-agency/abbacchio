import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { LOG_LEVELS, type IncomingLog, type IncomingLogOrEncrypted, type EncryptedLog, type LogEntry, type LogLevelLabel } from '../types.js';

/** Default channel name when none is specified */
export const DEFAULT_CHANNEL = 'default';

/**
 * Check if a log is encrypted
 */
function isEncryptedLog(log: IncomingLogOrEncrypted): log is EncryptedLog {
  return 'encrypted' in log && typeof log.encrypted === 'string';
}

/**
 * Event emitter for broadcasting logs via SSE
 * No storage - logs are only streamed in real-time to connected clients
 * Supports multiple channels (apps) with per-channel and global events
 */
export class LogBuffer extends EventEmitter {
  private channels: Set<string> = new Set([DEFAULT_CHANNEL]);

  constructor() {
    super();
  }

  /**
   * Normalize an incoming log to a standard format
   */
  private normalizeLog(incoming: IncomingLog, channel: string): LogEntry {
    const level = typeof incoming.level === 'number' ? incoming.level : 30;
    const levelLabel = (LOG_LEVELS[level as keyof typeof LOG_LEVELS] || 'info') as LogLevelLabel;

    // Extract known fields, put rest in data
    const { level: _, time, msg, message, namespace, name, ...rest } = incoming;

    return {
      id: nanoid(),
      level,
      levelLabel,
      time: time || Date.now(),
      msg: msg || message || '',
      namespace: namespace || name,
      channel,
      data: rest,
    };
  }

  /**
   * Create an encrypted log entry (server stores encrypted blob, client decrypts)
   */
  private createEncryptedEntry(encryptedLog: EncryptedLog, channel: string): LogEntry {
    return {
      id: nanoid(),
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
   * Register a channel
   */
  private registerChannel(channel: string): void {
    if (!this.channels.has(channel)) {
      this.channels.add(channel);
      this.emit('channel:added', channel);
    }
  }

  /**
   * Add a single log entry (broadcasts only, no storage)
   */
  add(incoming: IncomingLogOrEncrypted, channel: string = DEFAULT_CHANNEL): LogEntry {
    this.registerChannel(channel);
    const entry = this.processLog(incoming, channel);

    // Emit event for SSE subscribers (both channel-specific and global)
    this.emit('log', entry);
    this.emit(`log:${channel}`, entry);

    return entry;
  }

  /**
   * Add multiple log entries (broadcasts only, no storage)
   */
  addBatch(logs: IncomingLogOrEncrypted[], channel: string = DEFAULT_CHANNEL): LogEntry[] {
    this.registerChannel(channel);
    const entries = logs.map(log => this.processLog(log, channel));

    // Emit batch event (both channel-specific and global)
    this.emit('batch', entries);
    this.emit(`batch:${channel}`, entries);

    return entries;
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
    return [...this.channels];
  }

  /**
   * Clear channels (no logs to clear - no storage)
   */
  clear(channel?: string): void {
    if (!channel) {
      this.channels.clear();
      this.channels.add(DEFAULT_CHANNEL);
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
   * Subscribe to new logs (all channels or specific channel)
   */
  subscribe(callback: (entry: LogEntry) => void, channel?: string): () => void {
    const event = channel ? `log:${channel}` : 'log';
    this.on(event, callback);
    return () => this.off(event, callback);
  }
}

// Singleton instance
let instance: LogBuffer | null = null;

export function getLogBuffer(): LogBuffer {
  if (!instance) {
    instance = new LogBuffer();
  }
  return instance;
}

export function resetLogBuffer(): void {
  instance = null;
}
