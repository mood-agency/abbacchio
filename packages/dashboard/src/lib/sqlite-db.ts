import type { LogEntry, FilterLevels, FilterNamespaces } from '../types';
import SqliteWorker from './sqlite-worker?worker';

let worker: Worker | null = null;
let messageId = 0;
const pendingMessages = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new SqliteWorker();
    worker.onmessage = (e) => {
      const { id, success, result, error } = e.data;
      const pending = pendingMessages.get(id);
      if (pending) {
        pendingMessages.delete(id);
        if (success) {
          pending.resolve(result);
        } else {
          pending.reject(new Error(error));
        }
      }
    };
  }
  return worker;
}

function sendMessage<T = void>(action: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pendingMessages.set(id, { resolve: resolve as (value: unknown) => void, reject });
    getWorker().postMessage({ id, action, payload });
  });
}

let initPromise: Promise<void> | null = null;

/**
 * Initialize the SQLite database with OPFS persistence
 */
export async function initDatabase(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = sendMessage('init');
  return initPromise;
}

/**
 * Insert multiple logs into the database
 */
export async function insertLogs(logs: LogEntry[]): Promise<void> {
  if (logs.length === 0) return;
  await initDatabase();
  await sendMessage('insertLogs', logs);
}

/**
 * Update a single log (e.g., after decryption)
 */
export async function updateLog(log: LogEntry): Promise<void> {
  return insertLogs([log]);
}

/**
 * Clear all logs from the database
 */
export async function clearAllLogs(): Promise<void> {
  await initDatabase();
  await sendMessage('clearAllLogs');
}

/**
 * Clear logs for a specific channel
 */
export async function clearLogsForChannel(channel: string): Promise<void> {
  await initDatabase();
  await sendMessage('clearLogsForChannel', { channel });
}

export interface QueryOptions {
  search?: string;
  levels?: FilterLevels;
  namespaces?: FilterNamespaces;
  /** Minimum timestamp (ms) for time range filtering */
  minTime?: number;
  channel?: string;
  limit?: number;
  offset?: number;
}

type SQLiteRow = Record<string, string | number | null>;

/**
 * Convert a row from SQLite to a LogEntry object
 */
function rowToLogEntry(row: SQLiteRow): LogEntry {
  return {
    id: row.id as string,
    level: row.level as number,
    levelLabel: row.level_label as LogEntry['levelLabel'],
    time: row.time as number,
    msg: row.msg as string,
    namespace: row.namespace as string | undefined,
    channel: row.channel as string,
    data: JSON.parse(row.data as string) as Record<string, unknown>,
    encrypted: row.encrypted === 1,
    encryptedData: row.encrypted_data as string | undefined,
    decryptionFailed: row.decryption_failed === 1,
    wasEncrypted: row.was_encrypted === 1,
  };
}

/**
 * Query logs with combined search and filters in a single SQL query
 */
export async function queryLogs(options: QueryOptions = {}): Promise<LogEntry[]> {
  await initDatabase();
  const rows = await sendMessage<SQLiteRow[]>('queryLogs', options);
  return rows.map(rowToLogEntry);
}

/**
 * Get the count of logs matching the given filters
 */
export async function getFilteredCount(options: QueryOptions = {}): Promise<number> {
  await initDatabase();
  return sendMessage<number>('getFilteredCount', options);
}

/**
 * Get distinct namespaces from logs, optionally filtered by channel
 */
export async function getDistinctNamespaces(channel?: string): Promise<string[]> {
  await initDatabase();
  return sendMessage<string[]>('getDistinctNamespaces', { channel });
}

export type NamespaceCounts = Record<string, number>;

/**
 * Get counts of logs by namespace
 */
export async function getNamespaceCounts(options?: CountFilterOptions | string): Promise<NamespaceCounts> {
  await initDatabase();
  // Support both old string signature and new options object
  const payload = typeof options === 'string' ? { channel: options } : options;
  return sendMessage<NamespaceCounts>('getNamespaceCounts', payload);
}

/**
 * Get total count of all logs
 */
export async function getLogCount(): Promise<number> {
  await initDatabase();
  return sendMessage<number>('getLogCount');
}

/**
 * Check if any logs have encryption flags set
 */
export async function hasEncryptedLogs(channel?: string): Promise<boolean> {
  await initDatabase();
  return sendMessage<boolean>('hasEncryptedLogs', { channel });
}

/**
 * Get all logs that need decryption (encrypted or previously failed)
 */
export async function getLogsNeedingDecryption(channel?: string): Promise<LogEntry[]> {
  await initDatabase();
  const rows = await sendMessage<SQLiteRow[]>('getLogsNeedingDecryption', { channel });
  return rows.map(rowToLogEntry);
}

/**
 * Update multiple logs (batch update for re-decryption)
 */
export async function updateLogs(logs: LogEntry[]): Promise<void> {
  return insertLogs(logs);
}

/**
 * Requests persistent storage to prevent browser from evicting data
 */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) {
    return navigator.storage.persist();
  }
  return false;
}

export interface LevelCounts {
  all: number;
  trace: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
}

export interface CountFilterOptions {
  channel?: string;
  minTime?: number;
}

/**
 * Get counts of logs by level
 */
export async function getLevelCounts(options?: CountFilterOptions | string): Promise<LevelCounts> {
  await initDatabase();
  // Support both old string signature and new options object
  const payload = typeof options === 'string' ? { channel: options } : options;
  return sendMessage<LevelCounts>('getLevelCounts', payload);
}
