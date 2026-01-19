import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, FilterLevels, FilterNamespaces, TimeRange } from '../types';
import { TIME_RANGE_OPTIONS } from '../types';
import {
  queryLogs,
  getFilteredCount,
  getDistinctNamespaces,
  getLevelCounts,
  getNamespaceCounts,
  getHourlyLogCounts,
  getLogTimeRange,
  type LevelCounts,
  type NamespaceCounts,
  type HourlyLogCount,
  type LogTimeRange,
} from '../lib/sqlite-db';

// Maximum logs to load (virtualizer handles rendering efficiently)
const MAX_LOGS_LIMIT = 100000;

interface UseChannelLogStreamOptions {
  /** Channel name to filter logs */
  channelName: string | null;
  /** Filter settings from URL params */
  levelFilters: FilterLevels;
  namespaceFilters: FilterNamespaces;
  timeRange: TimeRange;
  searchQuery: string;
  /** Whether to use regex for search */
  useRegex: boolean;
  /** Whether search is case sensitive */
  caseSensitive: boolean;
  /** Subscribe to new logs for this channel */
  onNewLogs: (callback: (logs: LogEntry[], channelId: string) => void) => () => void;
  /** Subscribe to clear events for this channel */
  onClear: (callback: (channelId: string) => void) => () => void;
  /** Current channel ID */
  channelId: string | null;
}

interface UseChannelLogStreamResult {
  /** All filtered logs (virtualized rendering) */
  logs: LogEntry[];
  /** Total count of filtered logs */
  filteredCount: number;
  /** Available namespaces for filter dropdown */
  availableNamespaces: string[];
  /** Level counts for sidebar */
  levelCounts: LevelCounts;
  /** Namespace counts for sidebar */
  namespaceCounts: NamespaceCounts;
  /** Set of log IDs that are new (for highlight animation) */
  newLogIds: Set<string>;
  /** Whether logs are being loaded from database */
  isLoading: boolean;
  /** Hourly log counts for timeline visualization */
  hourlyData: HourlyLogCount[];
  /** Time range of available logs */
  logTimeRange: LogTimeRange;
}

export function useChannelLogStream(options: UseChannelLogStreamOptions): UseChannelLogStreamResult {
  const {
    channelName,
    levelFilters,
    namespaceFilters,
    timeRange,
    searchQuery,
    useRegex,
    caseSensitive,
    onNewLogs,
    onClear,
    channelId,
  } = options;

  // Results from SQL queries
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filteredCount, setFilteredCount] = useState(0);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [levelCounts, setLevelCounts] = useState<LevelCounts>({
    all: 0, trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0,
  });
  const [namespaceCounts, setNamespaceCounts] = useState<NamespaceCounts>({});

  // Timeline data
  const [hourlyData, setHourlyData] = useState<HourlyLogCount[]>([]);
  const [logTimeRange, setLogTimeRange] = useState<LogTimeRange>({ minTime: null, maxTime: null });

  // Track new log IDs for highlight animation
  const [newLogIds, setNewLogIds] = useState<Set<string>>(new Set());
  const newLogTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Track loading state for initial load
  const [isLoading, setIsLoading] = useState(true);

  // Ref for debounced metadata loading
  const metadataTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const METADATA_DEBOUNCE_MS = 300;

  // Load metadata (counts) with debounce - these queries are expensive on large datasets
  const loadMetadata = useCallback(async (channelName: string, currentMinTime: number | undefined) => {
    const countFilterOptions = {
      minTime: currentMinTime,
      channel: channelName,
    };

    try {
      const [namespaces, levelCountsResult, namespaceCountsResult] = await Promise.all([
        getDistinctNamespaces(channelName),
        getLevelCounts(countFilterOptions),
        getNamespaceCounts(countFilterOptions),
      ]);

      setAvailableNamespaces(namespaces);
      setLevelCounts(levelCountsResult);
      setNamespaceCounts(namespaceCountsResult);
    } catch (error) {
      console.error('Failed to load metadata:', error);
    }
  }, []);

  // Schedule debounced metadata load
  const scheduleMetadataLoad = useCallback((channelName: string, currentMinTime: number | undefined, immediate = false) => {
    if (metadataTimeoutRef.current) {
      clearTimeout(metadataTimeoutRef.current);
    }

    if (immediate) {
      loadMetadata(channelName, currentMinTime);
    } else {
      metadataTimeoutRef.current = setTimeout(() => {
        loadMetadata(channelName, currentMinTime);
      }, METADATA_DEBOUNCE_MS);
    }
  }, [loadMetadata]);

  // Load logs from SQLite with current filters (no pagination - virtualizer handles rendering)
  const loadLogs = useCallback(async (isInitialLoad = false) => {
    if (!channelName) {
      setLogs([]);
      setFilteredCount(0);
      setAvailableNamespaces([]);
      setLevelCounts({ all: 0, trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 });
      setNamespaceCounts({});
      setHourlyData([]);
      setLogTimeRange({ minTime: null, maxTime: null });
      // Keep isLoading true when no channel - we're waiting for channel selection
      return;
    }

    if (isInitialLoad) {
      setIsLoading(true);
    }

    // Recalculate minTime at query time for accuracy
    const currentMinTime = TIME_RANGE_OPTIONS[timeRange] === 0
      ? undefined
      : Date.now() - TIME_RANGE_OPTIONS[timeRange];

    const queryOptions = {
      search: searchQuery || undefined,
      useRegex,
      caseSensitive,
      levels: levelFilters.length > 0 ? levelFilters : undefined,
      namespaces: namespaceFilters.length > 0 ? namespaceFilters : undefined,
      minTime: currentMinTime,
      channel: channelName,
      limit: MAX_LOGS_LIMIT,
    };

    try {
      // Load logs, count, and timeline data
      const [fetchedLogs, count, hourlyLogCounts, timeRangeData] = await Promise.all([
        queryLogs(queryOptions),
        getFilteredCount({
          search: searchQuery || undefined,
          useRegex,
          caseSensitive,
          levels: levelFilters.length > 0 ? levelFilters : undefined,
          namespaces: namespaceFilters.length > 0 ? namespaceFilters : undefined,
          minTime: currentMinTime,
          channel: channelName,
        }),
        getHourlyLogCounts({ channel: channelName, minTime: currentMinTime }),
        getLogTimeRange(channelName),
      ]);

      setLogs(fetchedLogs);
      setFilteredCount(count);
      setHourlyData(hourlyLogCounts);
      setLogTimeRange(timeRangeData);

      // Load metadata with debounce (or immediately on initial load)
      scheduleMetadataLoad(channelName, currentMinTime, isInitialLoad);
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, useRegex, caseSensitive, levelFilters, namespaceFilters, timeRange, channelName, scheduleMetadataLoad]);

  // Cleanup metadata timeout on unmount
  useEffect(() => {
    return () => {
      if (metadataTimeoutRef.current) {
        clearTimeout(metadataTimeoutRef.current);
      }
    };
  }, []);

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
      // Reset loading state when switching to a new channel
      if (channelName) {
        setIsLoading(true);
      }
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
        // Mark incoming logs as new for highlight animation
        if (incomingLogs.length > 0) {
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
  }, [onNewLogs, channelId, channelName]);

  // Subscribe to clear
  useEffect(() => {
    const unsubscribe = onClear((clearedChannelId) => {
      if (clearedChannelId === channelId) {
        setLogs([]);
        setFilteredCount(0);
        setAvailableNamespaces([]);
        setLevelCounts({ all: 0, trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 });
        setNamespaceCounts({});
        setHourlyData([]);
        setLogTimeRange({ minTime: null, maxTime: null });
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

  return {
    logs,
    filteredCount,
    availableNamespaces,
    levelCounts,
    namespaceCounts,
    newLogIds,
    isLoading,
    hourlyData,
    logTimeRange,
  };
}
