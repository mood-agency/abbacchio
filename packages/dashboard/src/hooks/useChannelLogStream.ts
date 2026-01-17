import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, FilterLevel } from '../types';
import {
  queryLogs,
  getFilteredCount,
  getDistinctNamespaces,
  getLevelCounts,
  type LevelCounts,
} from '../lib/sqlite-db';

// Default page size options
export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

interface UseChannelLogStreamOptions {
  /** Channel name to filter logs */
  channelName: string | null;
  /** Filter settings from URL params */
  levelFilter: FilterLevel;
  namespaceFilter: string;
  searchQuery: string;
  /** Subscribe to new logs for this channel */
  onNewLogs: (callback: (logs: LogEntry[], channelId: string) => void) => () => void;
  /** Subscribe to clear events for this channel */
  onClear: (callback: (channelId: string) => void) => () => void;
  /** Current channel ID */
  channelId: string | null;
}

interface UseChannelLogStreamResult {
  /** Paginated logs for the current page (filtered) */
  logs: LogEntry[];
  /** Total count of filtered logs */
  filteredCount: number;
  /** Pagination */
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: PageSize;
  setPageSize: (size: PageSize) => void;
  totalPages: number;
  /** Available namespaces for filter dropdown */
  availableNamespaces: string[];
  /** Level counts for sidebar */
  levelCounts: LevelCounts;
  /** Set of log IDs that are new (for highlight animation) */
  newLogIds: Set<string>;
  /** Whether logs are being loaded from database */
  isLoading: boolean;
}

export function useChannelLogStream(options: UseChannelLogStreamOptions): UseChannelLogStreamResult {
  const {
    channelName,
    levelFilter,
    namespaceFilter,
    searchQuery,
    onNewLogs,
    onClear,
    channelId,
  } = options;

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

  // Track new log IDs for highlight animation
  const [newLogIds, setNewLogIds] = useState<Set<string>>(new Set());
  const newLogTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Track loading state for initial load
  const [isLoading, setIsLoading] = useState(true);

  // Track previous filter values for page reset
  const prevFiltersRef = useRef({ levelFilter, namespaceFilter, searchQuery, channelName });

  // Load logs from SQLite with current filters
  const loadLogs = useCallback(async (isInitialLoad = false) => {
    if (!channelName) {
      setLogs([]);
      setFilteredCount(0);
      setAvailableNamespaces([]);
      setLevelCounts({ all: 0, trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 });
      setIsLoading(false);
      return;
    }

    if (isInitialLoad) {
      setIsLoading(true);
    }

    const offset = (currentPage - 1) * pageSize;

    const queryOptions = {
      search: searchQuery || undefined,
      level: levelFilter,
      namespace: namespaceFilter || undefined,
      channel: channelName,
      limit: pageSize,
      offset,
    };

    try {
      const [fetchedLogs, count, namespaces, counts] = await Promise.all([
        queryLogs(queryOptions),
        getFilteredCount({
          search: searchQuery || undefined,
          level: levelFilter,
          namespace: namespaceFilter || undefined,
          channel: channelName,
        }),
        getDistinctNamespaces(),
        getLevelCounts(channelName),
      ]);

      setLogs(fetchedLogs);
      setFilteredCount(count);
      setAvailableNamespaces(namespaces);
      setLevelCounts(counts);
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, searchQuery, levelFilter, namespaceFilter, channelName]);

  // Track if this is the first load for this channel
  const isFirstLoadRef = useRef(true);
  const prevChannelRef = useRef(channelName);

  // Initial load and filter changes
  useEffect(() => {
    // Check if channel changed - if so, treat as initial load
    const isChannelChange = prevChannelRef.current !== channelName;
    if (isChannelChange) {
      isFirstLoadRef.current = true;
      prevChannelRef.current = channelName;
    }

    loadLogs(isFirstLoadRef.current);
    isFirstLoadRef.current = false;
  }, [loadLogs, channelName]);

  // Ref to hold the latest loadLogs function (avoids dependency in effect)
  const loadLogsRef = useRef(loadLogs);
  useEffect(() => {
    loadLogsRef.current = loadLogs;
  }, [loadLogs]);

  // Subscribe to new logs - reload when new logs arrive for this channel
  useEffect(() => {
    const unsubscribe = onNewLogs((incomingLogs, incomingChannelId) => {
      if (incomingChannelId === channelId || !incomingChannelId) {
        // Mark incoming logs as new for highlight animation (only on page 1)
        if (currentPage === 1 && incomingLogs.length > 0) {
          const incomingIds = incomingLogs.map((log) => log.id);
          setNewLogIds((prev) => {
            const next = new Set(prev);
            incomingIds.forEach((id) => next.add(id));
            return next;
          });

          // Schedule removal of highlight after animation duration (2s)
          incomingIds.forEach((id) => {
            // Clear existing timeout if any
            const existingTimeout = newLogTimeoutRef.current.get(id);
            if (existingTimeout) {
              clearTimeout(existingTimeout);
            }
            // Set new timeout to remove from newLogIds
            const timeout = setTimeout(() => {
              setNewLogIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
              newLogTimeoutRef.current.delete(id);
            }, 2000);
            newLogTimeoutRef.current.set(id, timeout);
          });
        }
        loadLogsRef.current();
      }
    });
    return unsubscribe;
  }, [onNewLogs, channelId, channelName, currentPage]);

  // Subscribe to clear
  useEffect(() => {
    const unsubscribe = onClear((clearedChannelId) => {
      if (clearedChannelId === channelId) {
        setLogs([]);
        setFilteredCount(0);
        setAvailableNamespaces([]);
        setLevelCounts({ all: 0, trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 });
        setCurrentPage(1);
        // Clear new log IDs and their timeouts
        setNewLogIds(new Set());
        newLogTimeoutRef.current.forEach((timeout) => clearTimeout(timeout));
        newLogTimeoutRef.current.clear();
      }
    });
    return unsubscribe;
  }, [onClear, channelId]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      newLogTimeoutRef.current.forEach((timeout) => clearTimeout(timeout));
      newLogTimeoutRef.current.clear();
    };
  }, []);

  // Calculate total pages
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));

  // Reset to page 1 when filters change
  useEffect(() => {
    const prev = prevFiltersRef.current;
    if (
      prev.levelFilter !== levelFilter ||
      prev.namespaceFilter !== namespaceFilter ||
      prev.searchQuery !== searchQuery ||
      prev.channelName !== channelName
    ) {
      setCurrentPage(1);
      prevFiltersRef.current = { levelFilter, namespaceFilter, searchQuery, channelName };
    }
  }, [levelFilter, namespaceFilter, searchQuery, channelName]);

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

  // Page change handler
  const handleSetCurrentPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  return {
    logs,
    filteredCount,
    currentPage,
    setCurrentPage: handleSetCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    availableNamespaces,
    levelCounts,
    newLogIds,
    isLoading,
  };
}
