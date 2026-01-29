import type { LogEntry, FilterLevels, FilterNamespaces } from '../../types';

/**
 * Query options for log retrieval
 */
export interface QueryOptions {
  search?: string;
  useRegex?: boolean;
  caseSensitive?: boolean;
  levels?: FilterLevels;
  namespaces?: FilterNamespaces;
  minTime?: number;
  channel?: string;
  limit?: number;
  offset?: number;
}

/**
 * Options for counting logs with filters
 */
export interface CountFilterOptions {
  channel?: string;
  minTime?: number;
}

/**
 * Level counts breakdown
 */
export interface LevelCounts {
  all: number;
  trace: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
}

/**
 * Namespace to count mapping
 */
export type NamespaceCounts = Record<string, number>;

/**
 * Database statistics
 */
export interface DatabaseStats {
  channelCount: number;
  totalRecords: number;
  databaseSize: number;
}

/**
 * Search match count options
 */
export interface SearchMatchCountOptions {
  search: string;
  channel?: string;
  minTime?: number;
  levels?: FilterLevels;
  namespaces?: FilterNamespaces;
  logIds?: string[];
}

/**
 * Prune options for TTL cleanup
 */
export interface PruneOptions {
  maxAgeMs?: number;
}

/**
 * Time window query options
 */
export interface TimeWindowQueryOptions {
  channel: string;
  centerTime: number;
  windowHalfSize: number;
  search?: string;
  useRegex?: boolean;
  caseSensitive?: boolean;
  levels?: FilterLevels;
  namespaces?: FilterNamespaces;
  limit?: number;
}

/**
 * Time window query result
 */
export interface TimeWindowResult {
  logs: LogEntry[];
  windowStart: number;
  windowEnd: number;
}

/**
 * Hourly log count for timeline
 */
export interface HourlyLogCount {
  hour: number;
  count: number;
}

/**
 * Log time range
 */
export interface LogTimeRange {
  minTime: number | null;
  maxTime: number | null;
}

/**
 * Options for getting hourly log counts
 */
export interface GetHourlyLogCountsOptions {
  channel: string;
  minTime?: number;
}

/**
 * Options for getting log index by time
 */
export interface GetLogIndexByTimeOptions {
  channel: string;
  targetTime: number;
  levels?: string[];
  namespaces?: string[];
  minTime?: number;
  search?: string;
}

/**
 * Abstract interface for log database storage.
 * Implemented by browser (Web Worker + OPFS) and native (Tauri + SQLite file) backends.
 */
export interface LogDatabase {
  // Lifecycle
  init(): Promise<void>;
  requestPersistence(): Promise<boolean>;

  // Core CRUD
  insertLogs(logs: LogEntry[]): Promise<void>;
  updateLog(log: LogEntry): Promise<void>;
  updateLogs(logs: LogEntry[]): Promise<void>;
  clearAllLogs(): Promise<void>;
  clearLogsForChannel(channel: string): Promise<void>;

  // Queries
  queryLogs(options?: QueryOptions): Promise<LogEntry[]>;
  queryLogsInTimeWindow(options: TimeWindowQueryOptions): Promise<TimeWindowResult>;
  getFilteredCount(options?: QueryOptions): Promise<number>;
  getLogCount(): Promise<number>;

  // Metadata
  getDistinctNamespaces(channel?: string): Promise<string[]>;
  getNamespaceCounts(options?: CountFilterOptions | string): Promise<NamespaceCounts>;
  getLevelCounts(options?: CountFilterOptions | string): Promise<LevelCounts>;
  getDatabaseStats(): Promise<DatabaseStats>;

  // Encryption
  hasEncryptedLogs(channel?: string): Promise<boolean>;
  getLogsNeedingDecryption(channel?: string): Promise<LogEntry[]>;

  // Timeline
  getHourlyLogCounts(options: GetHourlyLogCountsOptions): Promise<HourlyLogCount[]>;
  getLogTimeRange(channel: string): Promise<LogTimeRange>;
  getLogIndexByTime(options: GetLogIndexByTimeOptions): Promise<number>;

  // Search
  getSearchMatchCount(options: SearchMatchCountOptions): Promise<number>;

  // Maintenance
  pruneOldLogs(options?: PruneOptions): Promise<void>;
}

/**
 * Storage backend type
 */
export type StorageBackend = 'browser' | 'tauri';

/**
 * Detect which storage backend to use based on environment
 */
export function detectStorageBackend(): StorageBackend {
  // Check if running in Tauri
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    return 'tauri';
  }
  return 'browser';
}
