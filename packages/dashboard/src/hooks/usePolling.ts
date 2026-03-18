import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, MetricDataPoint, TraceSpan } from '../types';

const API_BASE = '/api';
const POLL_INTERVAL = 1000; // 1 second

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
  /** Add a new channel to watch */
  addChannel: (name: string) => void;
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
}

export function usePolling(initialChannel?: string | null, initialPaused?: boolean): UsePollingResult {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(initialChannel ?? null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metrics, setMetrics] = useState<MetricDataPoint[]>([]);
  const [traces, setTraces] = useState<TraceSpan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(initialPaused ?? false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreOlderLogs, setHasMoreOlderLogs] = useState(false);

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
  // Track manually added channels so they survive polling overwrites
  const manualChannelsRef = useRef<Set<string>>(new Set());
  // Track hasMoreOlderLogs in a ref for the stable loadOlderLogs callback
  const hasMoreOlderLogsRef = useRef(false);

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
      const res = await fetch(`${API_BASE}/channels`);
      if (!res.ok) return;
      const data = await res.json();
      const channelNames: string[] = data.channels || [];

      // Also get stats for log counts
      const statsRes = await fetch(`${API_BASE}/stats`);
      const statsData = statsRes.ok ? await statsRes.json() : { channels: { channels: [] } };
      const channelInfos = statsData.channels?.channels || [];

      const newChannels: Channel[] = channelNames.map(name => {
        const info = channelInfos.find((c: { name: string }) => c.name === name);
        return { name, logCount: info?.logCount || 0 };
      });

      // Remove manual channels that now exist on the server
      for (const name of channelNames) {
        manualChannelsRef.current.delete(name);
      }

      // Preserve manually added channels that aren't on the server yet
      for (const manualName of manualChannelsRef.current) {
        if (!newChannels.some(ch => ch.name === manualName)) {
          newChannels.push({ name: manualName, logCount: 0 });
        }
      }

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
  }, [activeChannel]);

  // Initial load when channel changes
  useEffect(() => {
    if (!activeChannel) {
      setIsLoading(false);
      return;
    }

    const loadInitial = async () => {
      await Promise.all([fetchLogs(true), fetchMetrics(), fetchTraces()]);
      setIsLoading(false);
    };
    loadInitial();
  }, [activeChannel]); // fetchLogs/fetchMetrics/fetchTraces are stable (no deps)

  // Poll for new data — runs once since all fetch callbacks are stable
  useEffect(() => {
    // Poll channels periodically
    const channelInterval = setInterval(fetchChannels, POLL_INTERVAL * 5);
    // Poll logs more frequently
    const logInterval = setInterval(fetchLogs, POLL_INTERVAL);
    // Poll metrics/traces less frequently
    const dataInterval = setInterval(() => {
      fetchMetrics();
      fetchTraces();
    }, POLL_INTERVAL * 3);

    // Initial channel fetch
    fetchChannels();

    return () => {
      clearInterval(channelInterval);
      clearInterval(logInterval);
      clearInterval(dataInterval);
    };
  }, [fetchChannels, fetchLogs, fetchMetrics, fetchTraces]);

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

      manualChannelsRef.current.delete(name);
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

  // Add channel
  const addChannel = useCallback((name: string) => {
    manualChannelsRef.current.add(name);
    setChannels(prev => {
      if (prev.some(ch => ch.name === name)) return prev;
      return [...prev, { name, logCount: 0 }];
    });
    setActiveChannel(name);
  }, []);

  return {
    channels,
    activeChannel,
    setActiveChannel,
    addChannel,
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
  };
}
