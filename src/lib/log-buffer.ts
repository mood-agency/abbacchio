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
 * Circular buffer for storing logs with SSE broadcasting
 * Supports multiple channels (apps) with per-channel and global events
 */
export class LogBuffer extends EventEmitter {
  private buffer: LogEntry[] = [];
  private maxSize: number;
  private channels: Set<string> = new Set([DEFAULT_CHANNEL]);

  constructor(maxSize = 1000) {
    super();
    this.maxSize = maxSize;
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
   * Add a single log entry
   */
  add(incoming: IncomingLogOrEncrypted, channel: string = DEFAULT_CHANNEL): LogEntry {
    this.registerChannel(channel);
    const entry = this.processLog(incoming, channel);

    this.buffer.push(entry);

    // Maintain circular buffer
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    // Emit event for SSE subscribers (both channel-specific and global)
    this.emit('log', entry);
    this.emit(`log:${channel}`, entry);

    return entry;
  }

  /**
   * Add multiple log entries
   */
  addBatch(logs: IncomingLogOrEncrypted[], channel: string = DEFAULT_CHANNEL): LogEntry[] {
    this.registerChannel(channel);
    const entries = logs.map(log => this.processLog(log, channel));

    for (const entry of entries) {
      this.buffer.push(entry);
    }

    // Trim buffer to max size
    while (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    // Emit batch event (both channel-specific and global)
    this.emit('batch', entries);
    this.emit(`batch:${channel}`, entries);

    return entries;
  }

  /**
   * Get all logs in buffer, optionally filtered by channel
   */
  getAll(channel?: string): LogEntry[] {
    if (channel) {
      return this.buffer.filter(entry => entry.channel === channel);
    }
    return [...this.buffer];
  }

  /**
   * Get all registered channels
   */
  getChannels(): string[] {
    return [...this.channels];
  }

  /**
   * Clear all logs, optionally only for a specific channel
   */
  clear(channel?: string): void {
    if (channel) {
      this.buffer = this.buffer.filter(entry => entry.channel !== channel);
      this.emit(`clear:${channel}`);
    } else {
      this.buffer = [];
      this.channels.clear();
      this.channels.add(DEFAULT_CHANNEL);
    }
    this.emit('clear', channel);
  }

  /**
   * Get buffer size, optionally for a specific channel
   */
  getSize(channel?: string): number {
    if (channel) {
      return this.buffer.filter(entry => entry.channel === channel).length;
    }
    return this.buffer.length;
  }

  /**
   * Get buffer size (total)
   */
  get size(): number {
    return this.buffer.length;
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

export function getLogBuffer(maxSize?: number): LogBuffer {
  if (!instance) {
    instance = new LogBuffer(maxSize);
  }
  return instance;
}

export function resetLogBuffer(): void {
  instance = null;
}
