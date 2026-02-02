/**
 * SQLite database abstraction layer
 *
 * This module provides a unified interface for log storage that works in both:
 * - Browser: Web Worker + OPFS (sql.js)
 * - Tauri: Native SQLite file (~/.abbacchio/logs.db)
 *
 * The Tauri backend enables MCP server access for Claude Code integration.
 *
 * @deprecated Import from './storage' instead for new code
 */

// Re-export everything from the new storage module for backward compatibility
export {
  // Lifecycle
  initDatabase,
  requestPersistence,

  // Core CRUD
  insertLogs,
  updateLog,
  updateLogs,
  clearAllLogs,
  clearLogsForChannel,

  // Queries
  queryLogs,
  queryLogsInTimeWindow,
  getFilteredCount,
  getLogCount,

  // Metadata
  getDistinctNamespaces,
  getNamespaceCounts,
  getLevelCounts,
  getDatabaseStats,

  // Encryption
  hasEncryptedLogs,
  getLogsNeedingDecryption,

  // Timeline
  getHourlyLogCounts,
  getLogTimeRange,
  getLogIndexByTime,

  // Search
  getSearchMatchCount,

  // Maintenance
  pruneOldLogs,

  // Utility
  getLogDatabase,
  getStorageBackend,
  isTauriEnvironment,
} from './storage';

// Re-export types
export type {
  QueryOptions,
  CountFilterOptions,
  LevelCounts,
  NamespaceCounts,
  DatabaseStats,
  SearchMatchCountOptions,
  PruneOptions,
  TimeWindowQueryOptions,
  TimeWindowResult,
  HourlyLogCount,
  LogTimeRange,
  GetHourlyLogCountsOptions,
  GetLogIndexByTimeOptions,
  LogDatabase,
  StorageBackend,
} from './storage';
