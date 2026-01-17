import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, FilterLevel } from '../types';
import { useLogStore } from './useLogStore';
import {
  queryLogs,
  getFilteredCount,
  getDistinctNamespaces,
  clearAllLogs,
} from '../lib/sqlite-db';

// Default page size options
export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

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
  /** Filter settings */
  levelFilter: FilterLevel;
  setLevelFilter: (level: FilterLevel) => void;
  namespaceFilter: string;
  setNamespaceFilter: (namespace: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
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
}

export function useLogStream(): UseLogStreamResult {
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

  // Filter state
  const [levelFilter, setLevelFilter] = useState<FilterLevel>('all');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(100);

  // Results from SQL queries
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filteredCount, setFilteredCount] = useState(0);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);

  // Debounce ref for search queries
  const searchTimeoutRef = useRef<number | null>(null);
  const lastQueryRef = useRef<string>('');

  // Load logs from SQLite with current filters
  const loadLogs = useCallback(async () => {
    const offset = (currentPage - 1) * pageSize;

    const options = {
      search: searchQuery || undefined,
      level: levelFilter,
      namespace: namespaceFilter || undefined,
      channel: urlChannel || undefined,
      limit: pageSize,
      offset,
    };

    try {
      const [fetchedLogs, count, namespaces] = await Promise.all([
        queryLogs(options),
        getFilteredCount({
          search: searchQuery || undefined,
          level: levelFilter,
          namespace: namespaceFilter || undefined,
          channel: urlChannel || undefined,
        }),
        getDistinctNamespaces(),
      ]);

      setLogs(fetchedLogs);
      setFilteredCount(count);
      setAvailableNamespaces(namespaces);
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
      setCurrentPage(1);
    });
    return unsubscribe;
  }, [onClear]);

  // Calculate total pages
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [levelFilter, namespaceFilter, pageSize]);

  // Debounced search query update
  const handleSetSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);

    // Clear any existing timeout
    if (searchTimeoutRef.current !== null) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Only reset page after debounce
    if (query !== lastQueryRef.current) {
      searchTimeoutRef.current = window.setTimeout(() => {
        setCurrentPage(1);
        lastQueryRef.current = query;
      }, 150);
    }
  }, []);

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
    levelFilter,
    setLevelFilter,
    namespaceFilter,
    setNamespaceFilter,
    searchQuery,
    setSearchQuery: handleSetSearchQuery,
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
  };
}
