import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { LogEntry, MetricDataPoint, TraceSpan } from '../types';

const API_BASE = '/api';
const POLL_INTERVAL = 1000; // 1 second

export interface ServerFilters {
  levels?: string[];
  namespaces?: string[];
}

interface Channel {
  name: string;
  logCount: number;
}

interface UsePollingResult {
  /** All channels discovered from the API */
  channels: Channel[];
  /** Currently selected channel name */
  activeChannel: string | null;
  /** Set active channel */
  setActiveChannel: (name: string) => void;
  /** Logs for the active channel */
  logs: LogEntry[];
  /** Metrics for the active channel */
  metrics: MetricDataPoint[];
  /** Traces for the active channel */
  traces: TraceSpan[];
  /** Whether we're currently loading initial data */
  isLoading: boolean;
  /** Whether polling is paused */
  isPaused: boolean;
  /** Toggle pause */
  setIsPaused: (paused: boolean) => void;
  /** Clear logs on the server */
  clearLogs: (channel?: string) => Promise<void>;
  /** Delete a channel and all its data */
  deleteChannel: (name: string) => Promise<void>;
  /** Load older logs (backward pagination) */
  loadOlderLogs: () => Promise<void>;
  /** Whether there are more older logs to load */
  hasMoreOlderLogs: boolean;
  /** Whether older logs are currently being loaded */
  isLoadingOlder: boolean;
  /** Total number of logs on the server for the active channel */
  serverTotal: number | null;
  /** Server-side level counts */
  serverLevelCounts: Record<string, number> | null;
  /** Server-side namespace counts */
  serverNamespaceCounts: Record<string, number> | null;
}

export function usePolling(initialChannel?: string | null, initialPaused?: boolean, serverFilters?: ServerFilters): UsePollingResult {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(initialChannel ?? null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metrics, setMetrics] = useState<MetricDataPoint[]>([]);
  const [traces, setTraces] = useState<TraceSpan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(initialPaused ?? false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreOlderLogs, setHasMoreOlderLogs] = useState(false);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [serverLevelCounts, setServerLevelCounts] = useState<Record<string, number> | null>(null);
  const [serverNamespaceCounts, setServerNamespaceCounts] = useState<Record<string, number> | null>(null);

  // Track the last log ID we've seen for incremental polling
  const lastLogIdRef = useRef<string | null>(null);
  // Track the oldest log ID for backward pagination
  const oldestLogIdRef = useRef<string | null>(null);
  const isPausedRef = useRef(isPaused);
  const activeChannelRef = useRef(activeChannel);
  // Prevent concurrent fetchLogs calls from all doing full fetches
  const fetchInFlightRef = useRef(false);
  // Prevent concurrent backward requests
  const loadOlderInFlightRef = useRef(false);
  // Track whether initial load has completed for the current channel
  const initialLoadDoneRef = useRef(false);
  // Track hasMoreOlderLogs in a ref for the stable loadOlderLogs callback
  const hasMoreOlderLogsRef = useRef(false);
  // Server-side filters ref for use in stable callbacks
  const serverFiltersRef = useRef(serverFilters);

  useEffect(() => {
    serverFiltersRef.current = serverFilters;
  }, [serverFilters]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  useEffect(() => {
    hasMoreOlderLogsRef.current = hasMoreOlderLogs;
  }, [hasMoreOlderLogs]);

  // Fetch channels list
  const fetchChannels = useCallback(async () => {
    try {
      const [res, statsRes] = await Promise.all([
        fetch(`${API_BASE}/channels`),
        fetch(`${API_BASE}/stats`),
      ]);
      if (!res.ok) return;
      const data = await res.json();
      const channelNames: string[] = data.channels || [];

      const statsData = statsRes.ok ? await statsRes.json() : { channels: { channels: [] } };
      const channelInfos = statsData.channels?.channels || [];

      const newChannels: Channel[] = channelNames.map(name => {
        const info = channelInfos.find((c: { name: string }) => c.name === name);
        return { name, logCount: info?.logCount || 0 };
      });

      setChannels(newChannels);

      // Auto-select first channel if none selected
      if (newChannels.length > 0) {
        if (!activeChannelRef.current) {
          setActiveChannel(newChannels[0].name);
        }
      }
    } catch (err) {
      console.error('Failed to fetch channels:', err);
    }
  }, []);

  // Fetch logs for active channel (incremental via afterId)
  // Uses refs to avoid re-creating the callback when activeChannel changes,
  // which would cause the polling effect to restart and trigger full re-fetches.
  const fetchLogs = useCallback(async (isInitialLoad = false) => {
    const channel = activeChannelRef.current;
    if (!channel || isPausedRef.current) return;

    // Polling calls must wait until the initial load completes to avoid
    // racing with it (both would do a full fetch with no afterId).
    if (!isInitialLoad && !initialLoadDoneRef.current) return;

    const isIncremental = !!lastLogIdRef.current;

    // If a full fetch is already in-flight, skip to avoid duplicate large requests
    if (!isIncremental && fetchInFlightRef.current) return;

    try {
      fetchInFlightRef.current = true;

      const params = new URLSearchParams({ channel });
      if (isIncremental) {
        params.set('afterId', lastLogIdRef.current!);
      }
      const filters = serverFiltersRef.current;
      if (filters?.levels && filters.levels.length > 0) {
        params.set('levels', filters.levels.join(','));
      }
      if (filters?.namespaces && filters.namespaces.length > 0) {
        params.set('namespaces', filters.namespaces.join(','));
      }

      const res = await fetch(`${API_BASE}/logs?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const newLogs: LogEntry[] = data.logs || [];

      // Verify we're still on the same channel (could have changed while awaiting)
      if (channel !== activeChannelRef.current) return;

      if (newLogs.length > 0) {
        lastLogIdRef.current = newLogs[newLogs.length - 1].id;

        if (!isIncremental) {
          // Initial load — replace all (API returns newest 1000 in chronological order)
          setLogs(newLogs);
          // Track oldest log for backward pagination
          oldestLogIdRef.current = newLogs[0].id;
          // Determine if there are older logs to load
          const total = data.total;
          if (total !== undefined) {
            setServerTotal(total);
            const hasMore = newLogs.length < total;
            setHasMoreOlderLogs(hasMore);
            hasMoreOlderLogsRef.current = hasMore;
          }
        } else {
          // Incremental — append, deduplicating by id
          setLogs(prev => {
            const existingIds = new Set(prev.map(l => l.id));
            const unique = newLogs.filter(l => !existingIds.has(l.id));
            if (unique.length === 0) return prev;
            setServerTotal(st => st !== null ? st + unique.length : null);
            return [...prev, ...unique];
          });
        }
      }

      if (isInitialLoad) {
        initialLoadDoneRef.current = true;
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      fetchInFlightRef.current = false;
    }
  }, []);

  // Fetch server-side counts for active channel
  const fetchCounts = useCallback(async () => {
    const channel = activeChannelRef.current;
    if (!channel) return;
    try {
      const res = await fetch(`${API_BASE}/logs/counts?channel=${encodeURIComponent(channel)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (channel !== activeChannelRef.current) return;
      setServerTotal(data.total ?? null);
      setServerLevelCounts(data.levels ?? null);
      setServerNamespaceCounts(data.namespaces ?? null);
    } catch (err) {
      console.error('Failed to fetch counts:', err);
    }
  }, []);

  // Fetch metrics for active channel
  const fetchMetrics = useCallback(async () => {
    const channel = activeChannelRef.current;
    if (!channel) return;
    try {
      const res = await fetch(`${API_BASE}/metrics?channel=${encodeURIComponent(channel)}`);
      if (!res.ok) return;
      const data = await res.json();
      setMetrics(data.metrics || []);
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  }, []);

  // Track last trace count + latest spanId to avoid replacing array when unchanged
  const lastTraceKeyRef = useRef<string>('');

  // Fetch traces for active channel
  const fetchTraces = useCallback(async () => {
    const channel = activeChannelRef.current;
    if (!channel) return;
    try {
      const res = await fetch(`${API_BASE}/traces?channel=${encodeURIComponent(channel)}`);
      if (!res.ok) return;
      const data = await res.json();
      const newTraces: TraceSpan[] = data.traces || [];

      // Build a quick fingerprint to skip setState when data is the same
      const key = newTraces.length > 0
        ? `${newTraces.length}:${newTraces[0].spanId}:${newTraces[newTraces.length - 1].spanId}`
        : '0';
      if (key !== lastTraceKeyRef.current) {
        lastTraceKeyRef.current = key;
        setTraces(newTraces);
      }
    } catch (err) {
      console.error('Failed to fetch traces:', err);
    }
  }, []);

  // Load older logs (backward pagination)
  const loadOlderLogs = useCallback(async () => {
    const channel = activeChannelRef.current;
    if (!channel || !oldestLogIdRef.current || loadOlderInFlightRef.current || !hasMoreOlderLogsRef.current) return;

    try {
      loadOlderInFlightRef.current = true;
      setIsLoadingOlder(true);

      const params = new URLSearchParams({
        channel,
        beforeId: oldestLogIdRef.current,
        limit: '500',
      });
      const filters = serverFiltersRef.current;
      if (filters?.levels && filters.levels.length > 0) {
        params.set('levels', filters.levels.join(','));
      }
      if (filters?.namespaces && filters.namespaces.length > 0) {
        params.set('namespaces', filters.namespaces.join(','));
      }

      const res = await fetch(`${API_BASE}/logs?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const olderLogs: LogEntry[] = data.logs || [];

      // Verify channel hasn't changed
      if (channel !== activeChannelRef.current) return;

      if (olderLogs.length > 0) {
        // Update oldest cursor
        oldestLogIdRef.current = olderLogs[0].id;

        // Prepend older logs (already in chronological order from API)
        setLogs(prev => {
          const existingIds = new Set(prev.map(l => l.id));
          const unique = olderLogs.filter(l => !existingIds.has(l.id));
          if (unique.length === 0) return prev;
          return [...unique, ...prev];
        });
      }

      const hasMore = data.hasMore ?? false;
      setHasMoreOlderLogs(hasMore);
      hasMoreOlderLogsRef.current = hasMore;
    } catch (err) {
      console.error('Failed to load older logs:', err);
    } finally {
      loadOlderInFlightRef.current = false;
      setIsLoadingOlder(false);
    }
  }, []);

  // Reset when channel changes
  useEffect(() => {
    setLogs([]);
    setMetrics([]);
    setTraces([]);
    lastLogIdRef.current = null;
    oldestLogIdRef.current = null;
    initialLoadDoneRef.current = false;
    loadOlderInFlightRef.current = false;
    lastTraceKeyRef.current = '';
    setIsLoading(true);
    setHasMoreOlderLogs(false);
    hasMoreOlderLogsRef.current = false;
    setIsLoadingOlder(false);
    setServerTotal(null);
    setServerLevelCounts(null);
    setServerNamespaceCounts(null);
  }, [activeChannel]);

  // Stable key to detect filter changes
  const filtersKey = useMemo(() => {
    if (!serverFilters) return '';
    return [
      (serverFilters.levels || []).sort().join(','),
      (serverFilters.namespaces || []).sort().join(','),
    ].join('|');
  }, [serverFilters]);

  // Re-fetch when server filters change
  const prevFiltersKeyRef = useRef(filtersKey);
  useEffect(() => {
    if (filtersKey === prevFiltersKeyRef.current) return;
    prevFiltersKeyRef.current = filtersKey;

    setLogs([]);
    lastLogIdRef.current = null;
    oldestLogIdRef.current = null;
    initialLoadDoneRef.current = false;
    setHasMoreOlderLogs(false);
    hasMoreOlderLogsRef.current = false;
    setServerTotal(null);

    if (activeChannelRef.current) {
      setIsLoading(true);
      Promise.all([fetchLogs(true), fetchCounts()]).then(() => setIsLoading(false));
    }
  }, [filtersKey, fetchLogs, fetchCounts]);

  // Initial load when channel changes
  useEffect(() => {
    if (!activeChannel) {
      setIsLoading(false);
      return;
    }

    const loadInitial = async () => {
      await Promise.all([fetchLogs(true), fetchMetrics(), fetchTraces(), fetchCounts()]);
      setIsLoading(false);
    };
    loadInitial();
  }, [activeChannel]); // fetchLogs/fetchMetrics/fetchTraces/fetchCounts are stable (no deps)

  // SSE Connection for logs
  useEffect(() => {
    const channel = activeChannel;
    if (!channel) return;
    
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let es: EventSource | null = null;
    let reconnectAttempts = 0;

    const connect = () => {
      const params = new URLSearchParams({ channel });
      const url = `${API_BASE}/stream?${params}`;
      
      es = new EventSource(url);
      
      es.addEventListener('logs', (e) => {
        if (isPausedRef.current) return;
        try {
          const newLogs: LogEntry[] = JSON.parse(e.data);
          if (newLogs.length > 0) {
            // Apply server-side filters on client side for the stream
            const filters = serverFiltersRef.current;
            const filteredLogs = newLogs.filter(log => {
               if (filters?.levels && filters.levels.length > 0 && !filters.levels.includes(log.levelLabel)) return false;
               if (filters?.namespaces && filters.namespaces.length > 0 && log.namespace && !filters.namespaces.includes(log.namespace)) return false;
               return true;
            });
            
            if (filteredLogs.length === 0) return;
            
            setLogs(prev => {
              const existingIds = new Set(prev.map(l => l.id));
              const unique = filteredLogs.filter(l => !existingIds.has(l.id));
              if (unique.length === 0) return prev;
              
              setServerTotal(st => st !== null ? st + unique.length : null);
              lastLogIdRef.current = unique[unique.length - 1].id;
              return [...prev, ...unique];
            });
          }
        } catch (err) {
          console.error('Failed to parse SSE logs:', err);
        }
      });
      
      es.addEventListener('clear', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.channel === channel || data.channel === 'all') {
             setLogs([]);
             setServerTotal(0);
             lastLogIdRef.current = null;
             oldestLogIdRef.current = null;
             setHasMoreOlderLogs(false);
             hasMoreOlderLogsRef.current = false;
          }
        } catch (err) {}
      });

      es.onopen = () => {
        reconnectAttempts = 0; // reset
      };

      es.onerror = () => {
        es?.close();
        // Exponential backoff: 1s, 2s, 4s, 8s, max 10s
        const backoff = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
        reconnectAttempts++;
        reconnectTimeout = setTimeout(connect, backoff);
      };
    };
    
    connect();
    
    return () => {
      if (es) es.close();
      clearTimeout(reconnectTimeout);
    };
  }, [activeChannel, filtersKey]);

  // Poll for other data (metrics, traces, counts, channels)
  useEffect(() => {
    // Poll channels periodically
    const channelInterval = setInterval(fetchChannels, POLL_INTERVAL * 5);
    // Poll metrics/traces/counts less frequently
    const dataInterval = setInterval(() => {
      fetchMetrics();
      fetchTraces();
      fetchCounts();
    }, POLL_INTERVAL * 3);

    // Initial channel fetch
    fetchChannels();

    return () => {
      clearInterval(channelInterval);
      clearInterval(dataInterval);
    };
  }, [fetchChannels, fetchMetrics, fetchTraces, fetchCounts]);

  // Clear logs
  const clearLogs = useCallback(async (channel?: string) => {
    const params = channel ? `?channel=${encodeURIComponent(channel)}` : '';
    try {
      await fetch(`${API_BASE}/logs${params}`, { method: 'DELETE' });
      setLogs([]);
      lastLogIdRef.current = null;
      oldestLogIdRef.current = null;
      setHasMoreOlderLogs(false);
      hasMoreOlderLogsRef.current = false;
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  }, []);

  // Delete channel
  const deleteChannel = useCallback(async (name: string) => {
    try {
      const res = await fetch(`${API_BASE}/channels?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete channel');

      setChannels(prev => prev.filter(ch => ch.name !== name));

      // Switch to another channel if the deleted one was active
      if (activeChannelRef.current === name) {
        setLogs([]);
        setMetrics([]);
        setTraces([]);
        lastLogIdRef.current = null;
        oldestLogIdRef.current = null;
        setHasMoreOlderLogs(false);
        hasMoreOlderLogsRef.current = false;
        setActiveChannel(null);
      }
    } catch (err) {
      console.error('Failed to delete channel:', err);
      throw err;
    }
  }, []);

  return {
    channels,
    activeChannel,
    setActiveChannel,
    deleteChannel,
    logs,
    metrics,
    traces,
    isLoading,
    isPaused,
    setIsPaused,
    clearLogs,
    loadOlderLogs,
    hasMoreOlderLogs,
    isLoadingOlder,
    serverTotal,
    serverLevelCounts,
    serverNamespaceCounts,
  };
}
