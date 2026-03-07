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
}

export function usePolling(initialChannel?: string | null): UsePollingResult {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(initialChannel ?? null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metrics, setMetrics] = useState<MetricDataPoint[]>([]);
  const [traces, setTraces] = useState<TraceSpan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  // Track the last log ID we've seen for incremental polling
  const lastLogIdRef = useRef<string | null>(null);
  const isPausedRef = useRef(isPaused);
  // Track manually added channels so they survive polling overwrites
  const manualChannelsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

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

      // Auto-select first channel if none selected (or if initial channel doesn't exist)
      if (newChannels.length > 0) {
        if (!activeChannel) {
          setActiveChannel(newChannels[0].name);
        }
      }
    } catch (err) {
      console.error('Failed to fetch channels:', err);
    }
  }, [activeChannel]);

  // Fetch logs for active channel (incremental via afterId)
  const fetchLogs = useCallback(async () => {
    if (!activeChannel || isPausedRef.current) return;

    try {
      const params = new URLSearchParams({ channel: activeChannel });
      if (lastLogIdRef.current) {
        params.set('afterId', lastLogIdRef.current);
      }

      const res = await fetch(`${API_BASE}/logs?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const newLogs: LogEntry[] = data.logs || [];

      if (newLogs.length > 0) {
        lastLogIdRef.current = newLogs[newLogs.length - 1].id;

        if (!lastLogIdRef.current || !params.has('afterId')) {
          // Initial load — replace all
          setLogs(newLogs);
        } else {
          // Incremental — append
          setLogs(prev => [...prev, ...newLogs]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  }, [activeChannel]);

  // Fetch metrics for active channel
  const fetchMetrics = useCallback(async () => {
    if (!activeChannel) return;
    try {
      const res = await fetch(`${API_BASE}/metrics?channel=${encodeURIComponent(activeChannel)}`);
      if (!res.ok) return;
      const data = await res.json();
      setMetrics(data.metrics || []);
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  }, [activeChannel]);

  // Track last trace count + latest spanId to avoid replacing array when unchanged
  const lastTraceKeyRef = useRef<string>('');

  // Fetch traces for active channel
  const fetchTraces = useCallback(async () => {
    if (!activeChannel) return;
    try {
      const res = await fetch(`${API_BASE}/traces?channel=${encodeURIComponent(activeChannel)}`);
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
  }, [activeChannel]);

  // Reset when channel changes
  useEffect(() => {
    setLogs([]);
    setMetrics([]);
    setTraces([]);
    lastLogIdRef.current = null;
    lastTraceKeyRef.current = '';
    setIsLoading(true);
  }, [activeChannel]);

  // Initial load when channel changes
  useEffect(() => {
    if (!activeChannel) {
      setIsLoading(false);
      return;
    }

    const loadInitial = async () => {
      await Promise.all([fetchLogs(), fetchMetrics(), fetchTraces()]);
      setIsLoading(false);
    };
    loadInitial();
  }, [activeChannel, fetchLogs, fetchMetrics, fetchTraces]);

  // Poll for new data
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
    } catch (err) {
      console.error('Failed to clear logs:', err);
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
    logs,
    metrics,
    traces,
    isLoading,
    isPaused,
    setIsPaused,
    clearLogs,
  };
}
