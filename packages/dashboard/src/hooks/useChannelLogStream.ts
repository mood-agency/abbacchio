import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, FilterLevels, FilterNamespaces, TimeRange } from '../types';
import { TIME_RANGE_OPTIONS } from '../types';
import {
  queryLogsInTimeWindow,
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

// Default window size: 2 hours on each side = 4 hour total window
const DEFAULT_WINDOW_HALF_SIZE = 2 * 60 * 60 * 1000; // 2 hours in ms

// Safety limit per window to prevent memory issues
const MAX_LOGS_PER_WINDOW = 50000;

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

/** Time window boundaries */
export interface LoadedTimeRange {
  start: number;
  end: number;
}

interface UseChannelLogStreamResult {
  /** Logs within the current time window */
  logs: LogEntry[];
  /** Total count of filtered logs (across all time) */
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
  /** Time range of all available logs */
  logTimeRange: LogTimeRange;
  /** Currently loaded time window */
  loadedTimeRange: LoadedTimeRange | null;
  /** Whether a time window is being loaded */
  isLoadingWindow: boolean;
  /** Navigate to a specific time, loading new window if needed */
  navigateToTime: (targetTime: number) => Promise<number>;
  /** Load a time window centered on a specific time, returns loaded logs */
  loadTimeWindow: (centerTime: number) => Promise<LogEntry[]>;
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

  // Time window state
  const [loadedTimeRange, setLoadedTimeRange] = useState<LoadedTimeRange | null>(null);
  const [isLoadingWindow, setIsLoadingWindow] = useState(false);
  const windowHalfSize = DEFAULT_WINDOW_HALF_SIZE;

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

  // Load a time window centered on a specific timestamp
  // Returns the loaded logs for immediate use (navigateToTime needs them)
  const loadTimeWindow = useCallback(async (centerTime: number, isInitialLoad = false): Promise<LogEntry[]> => {
    if (!channelName) {
      setLogs([]);
      setFilteredCount(0);
      setAvailableNamespaces([]);
      setLevelCounts({ all: 0, trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 });
      setNamespaceCounts({});
      setHourlyData([]);
      setLogTimeRange({ minTime: null, maxTime: null });
      setLoadedTimeRange(null);
      return [];
    }

    if (isInitialLoad) {
      setIsLoading(true);
    }
    setIsLoadingWindow(true);

    // Calculate minTime from time range filter (for sidebar counts, not window)
    const currentMinTime = TIME_RANGE_OPTIONS[timeRange] === 0
      ? undefined
      : Date.now() - TIME_RANGE_OPTIONS[timeRange];

    try {
      // Load logs in time window, count, and timeline data in parallel
      const [windowResult, count, hourlyLogCounts, timeRangeData] = await Promise.all([
        queryLogsInTimeWindow({
          channel: channelName,
          centerTime,
          windowHalfSize,
          search: searchQuery || undefined,
          useRegex,
          caseSensitive,
          levels: levelFilters.length > 0 ? levelFilters : undefined,
          namespaces: namespaceFilters.length > 0 ? namespaceFilters : undefined,
          limit: MAX_LOGS_PER_WINDOW,
        }),
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

      setLogs(windowResult.logs);
      setFilteredCount(count);
      setHourlyData(hourlyLogCounts);
      setLogTimeRange(timeRangeData);
      setLoadedTimeRange({
        start: windowResult.windowStart,
        end: windowResult.windowEnd,
      });

      // Load metadata with debounce (or immediately on initial load)
      scheduleMetadataLoad(channelName, currentMinTime, isInitialLoad);

      return windowResult.logs;
    } catch (error) {
      console.error('Failed to load time window:', error);
      return [];
    } finally {
      setIsLoading(false);
      setIsLoadingWindow(false);
    }
  }, [channelName, windowHalfSize, searchQuery, useRegex, caseSensitive, levelFilters, namespaceFilters, timeRange, scheduleMetadataLoad]);

  // Navigate to a specific time - returns index within loaded window
  const navigateToTime = useCallback(async (targetTime: number): Promise<number> => {
    // Check if target time is within current window
    if (loadedTimeRange &&
        targetTime >= loadedTimeRange.start &&
        targetTime <= loadedTimeRange.end) {
      // Already loaded - find index in current logs
      // Logs are sorted descending by time (newest first)
      const index = logs.findIndex(log => log.time <= targetTime);
      return index >= 0 ? index : 0;
    }

    // Need to load a new window centered on target time
    const newLogs = await loadTimeWindow(targetTime);

    // Find the index in the newly loaded logs
    // Logs are sorted descending by time (newest first)
    // We want to find the first log with time <= targetTime
    const index = newLogs.findIndex(log => log.time <= targetTime);
    return index >= 0 ? index : 0;
  }, [loadedTimeRange, logs, loadTimeWindow]);

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

  // Initial load and filter changes - always load window centered on "now"
  useEffect(() => {
    // Check if channel changed - if so, treat as initial load
    const isChannelChange = prevChannelRef.current !== channelName;
    if (isChannelChange) {
      isFirstLoadRef.current = true;
      prevChannelRef.current = channelName;
      // Reset loading state when switching to a new channel
      if (channelName) {
        setIsLoading(true);
        setLoadedTimeRange(null);
      }
    }

    // Load window centered on current time (most recent logs)
    loadTimeWindow(Date.now(), isFirstLoadRef.current);
    isFirstLoadRef.current = false;
  }, [loadTimeWindow, channelName]);

  // Ref to hold the latest functions (avoids dependency in effects)
  const loadTimeWindowRef = useRef(loadTimeWindow);
  const loadedTimeRangeRef = useRef(loadedTimeRange);
  useEffect(() => {
    loadTimeWindowRef.current = loadTimeWindow;
    loadedTimeRangeRef.current = loadedTimeRange;
  }, [loadTimeWindow, loadedTimeRange]);

  // Subscribe to new logs - add to window if viewing recent data
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

        // Check if we're viewing "recent" data (window includes present time)
        const currentRange = loadedTimeRangeRef.current;
        const now = Date.now();
        const isViewingRecent = currentRange && now >= currentRange.start && now <= currentRange.end + windowHalfSize;

        if (isViewingRecent) {
          // Add new logs that fall within the window
          const logsInWindow = incomingLogs.filter(log =>
            currentRange && log.time >= currentRange.start && log.time <= currentRange.end
          );

          if (logsInWindow.length > 0) {
            setLogs(prev => {
              // Add new logs at the beginning (most recent first)
              const newLogs = [...logsInWindow, ...prev];
              // Trim to max size if needed
              return newLogs.slice(0, MAX_LOGS_PER_WINDOW);
            });

            // Update count
            setFilteredCount(prev => prev + logsInWindow.length);
          }
        }
        // If viewing historical data, don't auto-add (would be confusing)
      }
    });
    return unsubscribe;
  }, [onNewLogs, channelId, windowHalfSize]);

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
        setLoadedTimeRange(null);
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
    loadedTimeRange,
    isLoadingWindow,
    navigateToTime,
    loadTimeWindow,
  };
}
