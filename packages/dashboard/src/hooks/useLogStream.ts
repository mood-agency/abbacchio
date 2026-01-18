import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, FilterLevel } from '../types';
import { useLogStore } from './useLogStore';
import {
  queryLogs,
  getFilteredCount,
  getDistinctNamespaces,
  clearAllLogs,
  getLevelCounts,
  type LevelCounts,
} from '../lib/sqlite-db';

// Default page size options
export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

interface UseLogStreamOptions {
  /** Filter settings from URL params */
  levelFilter: FilterLevel;
  namespaceFilter: string;
  searchQuery: string;
}

interface UseLogStreamResult {
  /** Paginated logs for the current page (filtered) */
  logs: LogEntry[];
  /** Total count of filtered logs */
  filteredCount: number;
  /** Total count of all logs in database */
  totalCount: number;
  /** Whether database initialization is complete */
  isInitialized: boolean;
  /** Pagination */
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: PageSize;
  setPageSize: (size: PageSize) => void;
  totalPages: number;
  /** Connection status */
  isConnected: boolean;
  isConnecting: boolean;
  clearLogs: () => void;
  connectionError: string | null;
  secretKey: string;
  setSecretKey: (key: string) => void;
  hasEncryptedLogs: boolean;
  channels: string[];
  urlChannel: string;
  /** Available namespaces for filter dropdown */
  availableNamespaces: string[];
  /** Persistence toggle */
  persistLogs: boolean;
  setPersistLogs: (persist: boolean) => void;
  /** Level counts for sidebar */
  levelCounts: LevelCounts;
}

export function useLogStream(options: UseLogStreamOptions): UseLogStreamResult {
  const { levelFilter, namespaceFilter, searchQuery } = options;

  const {
    totalCount,
    isInitialized,
    clearLogs: clearStore,
    onNewLogs,
    onClear,
    isConnected,
    isConnecting,
    connectionError,
    secretKey,
    setSecretKey,
    hasEncryptedLogs,
    channels,
    urlChannel,
    persistLogs,
    setPersistLogs,
  } = useLogStore();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(100);

  // Results from SQL queries
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filteredCount, setFilteredCount] = useState(0);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [levelCounts, setLevelCounts] = useState<LevelCounts>({
    all: 0, trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0,
  });

  // Track previous filter values for page reset
  const prevFiltersRef = useRef({ levelFilter, namespaceFilter, searchQuery });

  // Load logs from SQLite with current filters
  const loadLogs = useCallback(async () => {
    const offset = (currentPage - 1) * pageSize;

    // Convert FilterLevel to FilterLevels (exclude 'all')
    const levels = levelFilter && levelFilter !== 'all' ? [levelFilter] : undefined;

    const options = {
      search: searchQuery || undefined,
      levels,
      namespaces: namespaceFilter ? [namespaceFilter] : undefined,
      channel: urlChannel || undefined,
      limit: pageSize,
      offset,
    };

    try {
      const [fetchedLogs, count, namespaces, counts] = await Promise.all([
        queryLogs(options),
        getFilteredCount({
          search: searchQuery || undefined,
          levels,
          namespaces: namespaceFilter ? [namespaceFilter] : undefined,
          channel: urlChannel || undefined,
        }),
        getDistinctNamespaces(),
        getLevelCounts(urlChannel || undefined),
      ]);

      setLogs(fetchedLogs);
      setFilteredCount(count);
      setAvailableNamespaces(namespaces);
      setLevelCounts(counts);
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
  }, [currentPage, pageSize, searchQuery, levelFilter, namespaceFilter, urlChannel]);

  // Initial load and filter changes
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Subscribe to new logs - reload when new logs arrive
  useEffect(() => {
    const unsubscribe = onNewLogs(() => {
      // Reload logs when new data arrives
      loadLogs();
    });
    return unsubscribe;
  }, [onNewLogs, loadLogs]);

  // Subscribe to clear
  useEffect(() => {
    const unsubscribe = onClear(async () => {
      setLogs([]);
      setFilteredCount(0);
      setAvailableNamespaces([]);
      setLevelCounts({ all: 0, trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 });
      setCurrentPage(1);
    });
    return unsubscribe;
  }, [onClear]);

  // Calculate total pages
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));

  // Reset to page 1 when filters change
  useEffect(() => {
    const prev = prevFiltersRef.current;
    if (
      prev.levelFilter !== levelFilter ||
      prev.namespaceFilter !== namespaceFilter ||
      prev.searchQuery !== searchQuery
    ) {
      setCurrentPage(1);
      prevFiltersRef.current = { levelFilter, namespaceFilter, searchQuery };
    }
  }, [levelFilter, namespaceFilter, searchQuery]);

  // Also reset page when pageSize changes
  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize]);

  // Ensure current page is valid
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Clear logs wrapper
  const clearLogs = useCallback(async () => {
    await clearStore();
    await clearAllLogs();
  }, [clearStore]);

  // Page change handler
  const handleSetCurrentPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  return {
    logs,
    filteredCount,
    totalCount,
    isInitialized,
    currentPage,
    setCurrentPage: handleSetCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    isConnected,
    isConnecting,
    clearLogs,
    connectionError,
    secretKey,
    setSecretKey,
    hasEncryptedLogs,
    channels,
    urlChannel,
    availableNamespaces,
    persistLogs,
    setPersistLogs,
    levelCounts,
  };
}
