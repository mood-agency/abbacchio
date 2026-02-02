/**
 * Storage layer abstraction for log database
 *
 * Automatically selects the appropriate backend:
 * - Browser: Web Worker + OPFS (sql.js)
 * - Tauri: Native SQLite file (~/.abbacchio/logs.db)
 *
 * The Tauri backend stores logs in a location accessible by the MCP server,
 * enabling Claude Code to query logs for debugging assistance.
 */

import { detectStorageBackend, type LogDatabase, type StorageBackend } from './types';
import { BrowserLogDatabase } from './browser-adapter';
import { TauriLogDatabase } from './tauri-adapter';

// Re-export types
export * from './types';

// Singleton instance
let database: LogDatabase | null = null;
let currentBackend: StorageBackend | null = null;

/**
 * Get the log database instance.
 * Creates the appropriate adapter based on the detected environment.
 */
export function getLogDatabase(): LogDatabase {
  if (database) return database;

  currentBackend = detectStorageBackend();

  if (currentBackend === 'tauri') {
    console.log('[Storage] Using Tauri native SQLite backend');
    database = new TauriLogDatabase();
  } else {
    console.log('[Storage] Using browser OPFS backend');
    database = new BrowserLogDatabase();
  }

  return database;
}

/**
 * Get the current storage backend type
 */
export function getStorageBackend(): StorageBackend {
  if (!currentBackend) {
    currentBackend = detectStorageBackend();
  }
  return currentBackend;
}

/**
 * Check if running in Tauri (native SQLite available for MCP)
 */
export function isTauriEnvironment(): boolean {
  return getStorageBackend() === 'tauri';
}

// ============================================================================
// Convenience exports - delegate to singleton instance
// These maintain backward compatibility with existing code
// ============================================================================

export async function initDatabase(): Promise<void> {
  return getLogDatabase().init();
}

export async function requestPersistence(): Promise<boolean> {
  return getLogDatabase().requestPersistence();
}

export async function insertLogs(
  logs: import('../../types').LogEntry[]
): Promise<void> {
  return getLogDatabase().insertLogs(logs);
}

export async function updateLog(
  log: import('../../types').LogEntry
): Promise<void> {
  return getLogDatabase().updateLog(log);
}

export async function updateLogs(
  logs: import('../../types').LogEntry[]
): Promise<void> {
  return getLogDatabase().updateLogs(logs);
}

export async function clearAllLogs(): Promise<void> {
  return getLogDatabase().clearAllLogs();
}

export async function clearLogsForChannel(channel: string): Promise<void> {
  return getLogDatabase().clearLogsForChannel(channel);
}

export async function queryLogs(
  options?: import('./types').QueryOptions
): Promise<import('../../types').LogEntry[]> {
  return getLogDatabase().queryLogs(options);
}

export async function queryLogsInTimeWindow(
  options: import('./types').TimeWindowQueryOptions
): Promise<import('./types').TimeWindowResult> {
  return getLogDatabase().queryLogsInTimeWindow(options);
}

export async function getFilteredCount(
  options?: import('./types').QueryOptions
): Promise<number> {
  return getLogDatabase().getFilteredCount(options);
}

export async function getLogCount(): Promise<number> {
  return getLogDatabase().getLogCount();
}

export async function getDistinctNamespaces(
  channel?: string
): Promise<string[]> {
  return getLogDatabase().getDistinctNamespaces(channel);
}

export async function getNamespaceCounts(
  options?: import('./types').CountFilterOptions | string
): Promise<import('./types').NamespaceCounts> {
  return getLogDatabase().getNamespaceCounts(options);
}

export async function getLevelCounts(
  options?: import('./types').CountFilterOptions | string
): Promise<import('./types').LevelCounts> {
  return getLogDatabase().getLevelCounts(options);
}

export async function getDatabaseStats(): Promise<
  import('./types').DatabaseStats
> {
  return getLogDatabase().getDatabaseStats();
}

export async function hasEncryptedLogs(channel?: string): Promise<boolean> {
  return getLogDatabase().hasEncryptedLogs(channel);
}

export async function getLogsNeedingDecryption(
  channel?: string
): Promise<import('../../types').LogEntry[]> {
  return getLogDatabase().getLogsNeedingDecryption(channel);
}

export async function getHourlyLogCounts(
  options: import('./types').GetHourlyLogCountsOptions
): Promise<import('./types').HourlyLogCount[]> {
  return getLogDatabase().getHourlyLogCounts(options);
}

export async function getLogTimeRange(
  channel: string
): Promise<import('./types').LogTimeRange> {
  return getLogDatabase().getLogTimeRange(channel);
}

export async function getLogIndexByTime(
  options: import('./types').GetLogIndexByTimeOptions
): Promise<number> {
  return getLogDatabase().getLogIndexByTime(options);
}

export async function getSearchMatchCount(
  options: import('./types').SearchMatchCountOptions
): Promise<number> {
  return getLogDatabase().getSearchMatchCount(options);
}

export async function pruneOldLogs(
  options?: import('./types').PruneOptions
): Promise<void> {
  return getLogDatabase().pruneOldLogs(options);
}
