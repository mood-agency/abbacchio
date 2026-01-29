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
 * Obtain the singleton LogDatabase, creating and caching a backend-specific adapter when absent.
 *
 * @returns The singleton LogDatabase instance.
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
 * Return the currently selected storage backend, detecting and caching it if unset.
 *
 * @returns The selected StorageBackend (`'tauri'` or `'browser'`) 
 */
export function getStorageBackend(): StorageBackend {
  if (!currentBackend) {
    currentBackend = detectStorageBackend();
  }
  return currentBackend;
}

/**
 * Determine whether the current storage backend is Tauri (native SQLite).
 *
 * @returns `true` if the detected storage backend is `'tauri'`, indicating native SQLite is available, `false` otherwise.
 */
export function isTauriEnvironment(): boolean {
  return getStorageBackend() === 'tauri';
}

// ============================================================================
// Convenience exports - delegate to singleton instance
// These maintain backward compatibility with existing code
/**
 * Initializes the singleton log database.
 *
 * Ensures the chosen storage backend is initialized and ready for use by other database APIs.
 */

export async function initDatabase(): Promise<void> {
  return getLogDatabase().init();
}

/**
 * Requests that the runtime persist the database storage to reduce risk of eviction.
 *
 * @returns `true` if persistent storage was granted, `false` otherwise.
 */
export async function requestPersistence(): Promise<boolean> {
  return getLogDatabase().requestPersistence();
}

/**
 * Stores multiple log entries in the configured log database.
 *
 * @param logs - Array of `LogEntry` objects to persist
 */
export async function insertLogs(
  logs: import('../../types').LogEntry[]
): Promise<void> {
  return getLogDatabase().insertLogs(logs);
}

/**
 * Update an existing log entry in the configured log database.
 *
 * @param log - The log entry to update
 */
export async function updateLog(
  log: import('../../types').LogEntry
): Promise<void> {
  return getLogDatabase().updateLog(log);
}

/**
 * Update multiple log entries in the current log database.
 *
 * @param logs - The log entries to update
 */
export async function updateLogs(
  logs: import('../../types').LogEntry[]
): Promise<void> {
  return getLogDatabase().updateLogs(logs);
}

/**
 * Clears all stored log entries from the current log database.
 */
export async function clearAllLogs(): Promise<void> {
  return getLogDatabase().clearAllLogs();
}

/**
 * Deletes all log entries associated with the given channel.
 *
 * @param channel - The channel identifier whose logs should be removed
 */
export async function clearLogsForChannel(channel: string): Promise<void> {
  return getLogDatabase().clearLogsForChannel(channel);
}

/**
 * Fetches log entries that match the given query options.
 *
 * @param options - Optional query filters and pagination/sorting options
 * @returns An array of `LogEntry` objects that match the provided options
 */
export async function queryLogs(
  options?: import('./types').QueryOptions
): Promise<import('../../types').LogEntry[]> {
  return getLogDatabase().queryLogs(options);
}

/**
 * Fetches logs that fall within a specified time window and returns associated windowed results.
 *
 * @param options - Options specifying the time window and additional query filters (channel, search, pagination, etc.)
 * @returns A `TimeWindowResult` containing the matching log entries and related time-window metadata.
 */
export async function queryLogsInTimeWindow(
  options: import('./types').TimeWindowQueryOptions
): Promise<import('./types').TimeWindowResult> {
  return getLogDatabase().queryLogsInTimeWindow(options);
}

/**
 * Retrieve the count of log entries that match the provided query filters.
 *
 * @param options - Query options used to filter which log entries are counted
 * @returns The number of log entries matching `options`
 */
export async function getFilteredCount(
  options?: import('./types').QueryOptions
): Promise<number> {
  return getLogDatabase().getFilteredCount(options);
}

/**
 * Get the total number of log entries in the database.
 *
 * @returns The total number of log entries.
 */
export async function getLogCount(): Promise<number> {
  return getLogDatabase().getLogCount();
}

/**
 * Retrieve distinct namespaces present in the log database.
 *
 * @param channel - Optional channel name to limit returned namespaces to that channel
 * @returns An array of distinct namespace strings present in the database; filtered by `channel` if provided
 */
export async function getDistinctNamespaces(
  channel?: string
): Promise<string[]> {
  return getLogDatabase().getDistinctNamespaces(channel);
}

/**
 * Fetches counts of log entries grouped by namespace, optionally filtered.
 *
 * @param options - Either a channel name string or a `CountFilterOptions` object to limit which logs are counted
 * @returns A `NamespaceCounts` object mapping each namespace to the number of matching log entries
 */
export async function getNamespaceCounts(
  options?: import('./types').CountFilterOptions | string
): Promise<import('./types').NamespaceCounts> {
  return getLogDatabase().getNamespaceCounts(options);
}

/**
 * Retrieve counts of log entries grouped by level, optionally filtered by channel or other criteria.
 *
 * @param options - A channel name string or a CountFilterOptions object to restrict which logs are counted.
 * @returns An object mapping log levels to their respective counts.
 */
export async function getLevelCounts(
  options?: import('./types').CountFilterOptions | string
): Promise<import('./types').LevelCounts> {
  return getLogDatabase().getLevelCounts(options);
}

/**
 * Fetches statistics for the active log database.
 *
 * @returns Database statistics object containing metrics such as storage size, record counts, and index/state information.
 */
export async function getDatabaseStats(): Promise<
  import('./types').DatabaseStats
> {
  return getLogDatabase().getDatabaseStats();
}

/**
 * Check whether the database contains any encrypted log entries.
 *
 * @param channel - Optional channel name to limit the check to that channel
 * @returns `true` if there are encrypted logs (in the specified channel when provided), `false` otherwise
 */
export async function hasEncryptedLogs(channel?: string): Promise<boolean> {
  return getLogDatabase().hasEncryptedLogs(channel);
}

/**
 * Retrieve log entries that are encrypted and require decryption.
 *
 * @param channel - Optional channel name to limit the search to that channel
 * @returns An array of `LogEntry` objects that need decryption (filtered by `channel` if provided)
 */
export async function getLogsNeedingDecryption(
  channel?: string
): Promise<import('../../types').LogEntry[]> {
  return getLogDatabase().getLogsNeedingDecryption(channel);
}

/**
 * Fetches hourly-aggregated log counts that match the provided query options.
 *
 * @param options - Query options controlling the time range and filters (for example: channel, namespace, levels, and time bounds) used to compute hourly counts
 * @returns An array of hourly log count objects, each representing the number of logs for a specific hour within the queried range
 */
export async function getHourlyLogCounts(
  options: import('./types').GetHourlyLogCountsOptions
): Promise<import('./types').HourlyLogCount[]> {
  return getLogDatabase().getHourlyLogCounts(options);
}

/**
 * Retrieves the time range of logs for the specified channel.
 *
 * @param channel - The channel identifier to scope the query
 * @returns The log time range for `channel` as a `LogTimeRange` object
 */
export async function getLogTimeRange(
  channel: string
): Promise<import('./types').LogTimeRange> {
  return getLogDatabase().getLogTimeRange(channel);
}

/**
 * Compute the zero-based index of a log entry for a specified time query.
 *
 * @param options - Options specifying the target time and any optional filters that narrow the search
 * @returns The zero-based index of the log entry that corresponds to the provided time and filters
 */
export async function getLogIndexByTime(
  options: import('./types').GetLogIndexByTimeOptions
): Promise<number> {
  return getLogDatabase().getLogIndexByTime(options);
}

/**
 * Count log entries that match the given search criteria.
 *
 * @param options - Search and filter options determining which logs are counted
 * @returns The number of log entries matching the provided search criteria
 */
export async function getSearchMatchCount(
  options: import('./types').SearchMatchCountOptions
): Promise<number> {
  return getLogDatabase().getSearchMatchCount(options);
}

/**
 * Prunes old log entries from the current log database according to the provided options.
 *
 * @param options - Prune criteria and retention settings that determine which logs are removed
 */
export async function pruneOldLogs(
  options?: import('./types').PruneOptions
): Promise<void> {
  return getLogDatabase().pruneOldLogs(options);
}