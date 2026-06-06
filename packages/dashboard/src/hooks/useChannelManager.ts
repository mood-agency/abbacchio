import { useState, useEffect, useRef, useCallback } from 'react';
import type { LogEntry } from '../types';


import {
  initDatabase,
  insertLogs,
  clearLogsForChannel,
  getLogCount,
  requestPersistence,
} from '../lib/sqlite-db';

// Debug logging - enable in browser console: window.__DEBUG_CHANNEL_MANAGER__ = true
const debug = (...args: unknown[]) => {
  if ((window as unknown as { __DEBUG_CHANNEL_MANAGER__?: boolean }).__DEBUG_CHANNEL_MANAGER__) {
    console.log('[ChannelManager]', ...args);
  }
};


export interface ChannelConfig {
  id: string;
  name: string;
}

export interface ChannelState {
  id: string;
  name: string;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
}

export interface UseChannelManagerResult {
  /** List of connected channels */
  channels: ChannelState[];
  /** Currently active channel ID */
  activeChannelId: string | null;
  /** Set active channel */
  setActiveChannelId: (id: string) => void;
  /** Add a new channel connection */
  addChannel: (name: string) => void;
  /** Remove a channel connection */
  removeChannel: (id: string) => void;
  /** Whether database initialization is complete */
  isInitialized: boolean;
  /** Total number of logs in database */
  totalCount: number;
  /** Clear logs for a specific channel */
  clearChannelLogs: (channelId: string) => Promise<void>;
  /** Subscribe to new log notifications - callback receives the new logs */
  onNewLogs: (callback: (logs: LogEntry[], channelId: string) => void) => () => void;
  /** Subscribe to clear notifications */
  onClear: (callback: (channelId: string) => void) => () => void;
  /** Persistence toggle */
  persistLogs: boolean;
  setPersistLogs: (persist: boolean) => void;
  /** Whether log streaming is paused */
  isPaused: boolean;
  /** Toggle pause state */
  setIsPaused: (paused: boolean) => void;
}

// Generate unique ID for channels
function generateId(): string {
  return `ch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const initialUrlParams = (() => {
  const params = new URLSearchParams(window.location.search);
  const channel = params.get('channel') || '';

  return { channel };
})();

const API_BASE = '/api';


export function useChannelManager(): UseChannelManagerResult {
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [activeChannelId, setActiveChannelIdInternal] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [persistLogs, setPersistLogs] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  // Use standard localStorage for channel persistence
  const [initialChannels] = useState<ChannelConfig[]>(() => {
    try {
      const data = localStorage.getItem('abbacchio-channels');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load channels from local storage:', e);
      return [];
    }
  });

  const saveChannels = useCallback((channelsToSave: ChannelConfig[]) => {
    try {
      localStorage.setItem('abbacchio-channels', JSON.stringify(channelsToSave));
    } catch (e) {
      console.error('Failed to save channels to local storage:', e);
    }
  }, []);

  // Update URL when active channel changes
  const setActiveChannelId = useCallback((id: string | null) => {
    setActiveChannelIdInternal(id);
  }, []);

  // Sync URL with active channel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentChannel = params.get('channel');

    if (!activeChannelId) {
      if (currentChannel) {
        params.delete('channel');
        const newUrl = params.toString()
          ? `${window.location.pathname}?${params.toString()}`
          : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }
      return;
    }

    const channel = channels.find((ch) => ch.id === activeChannelId);
    if (!channel) return;

    if (currentChannel !== channel.name) {
      params.set('channel', channel.name);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, [activeChannelId, channels]);

  // Refs
  const channelsRef = useRef<ChannelState[]>([]);
  const initializedRef = useRef(false);
  const processEntryRef = useRef<typeof processEntry | null>(null);

  // Polling refs
  const lastLogIdsRef = useRef<Map<string, string>>(new Map());
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());

  // Callbacks for subscribers
  const newLogsCallbacks = useRef<Set<(logs: LogEntry[], channelId: string) => void>>(new Set());
  const clearCallbacks = useRef<Set<(channelId: string) => void>>(new Set());

  // Batching
  const pendingLogsRef = useRef<Map<string, LogEntry[]>>(new Map());
  const flushTimeoutRef = useRef<number | null>(null);
  const isFlushing = useRef(false);
  const persistLogsRef = useRef(persistLogs);
  const isPausedRef = useRef(isPaused);
  const BATCH_INTERVAL_MS = 100;
  const flushPendingLogsRef = useRef<() => void>(() => {});

  // Keep refs in sync
  useEffect(() => { persistLogsRef.current = persistLogs; }, [persistLogs]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  // Sync channels to secure storage
  useEffect(() => {
    debug('Sync effect triggered:', { isInitialized, channelsCount: channels.length });
    if (!isInitialized) { debug('Skipping save - not initialized yet'); return; }

    const configs = channels.map((ch) => ({ id: ch.id, name: ch.name }));
    saveChannels(configs);
  }, [channels, isInitialized, saveChannels]);

  // Schedule flush
  const scheduleFlush = useCallback(() => {
    if (flushTimeoutRef.current === null) {
      flushTimeoutRef.current = window.setTimeout(() => {
        flushPendingLogsRef.current();
      }, BATCH_INTERVAL_MS);
    }
  }, []);

  // Initialize database and load saved channels
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const init = async () => {
      debug('init() starting...');
      await initDatabase();
      await requestPersistence();
      const count = await getLogCount();
      setTotalCount(count);
      setIsInitialized(true);
      debug('Database initialized, checking URL params:', initialUrlParams);

      const channelStates: ChannelState[] = initialChannels.map((config) => {
        pendingLogsRef.current.set(config.id, []);
        return {
          id: config.id, name: config.name,
          isConnected: false, isConnecting: true, connectionError: null,
        };
      });

      let activeId: string | null = null;
      if (initialUrlParams.channel) {
        const existingChannel = channelStates.find((ch) => ch.name === initialUrlParams.channel);
        if (existingChannel) {
          activeId = existingChannel.id;
          debug('URL channel found in saved channels:', existingChannel.name);
        } else {
          const id = generateId();
          pendingLogsRef.current.set(id, []);
          channelStates.push({
            id, name: initialUrlParams.channel,
            isConnected: false, isConnecting: true, connectionError: null,
          });
          activeId = id;
          debug('URL channel added:', initialUrlParams.channel);
        }
      }

      if (channelStates.length > 0) {
        setChannels(channelStates);
        setActiveChannelId(activeId || channelStates[0].id);
        channelStates.forEach((ch) => { startPolling(ch.id, ch.name); });
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChannels]);

  // Notify subscribers
  const notifyNewLogs = useCallback((logs: LogEntry[], channelId: string) => {
    newLogsCallbacks.current.forEach((cb) => cb(logs, channelId));
  }, []);

  const notifyClear = useCallback((channelId: string) => {
    clearCallbacks.current.forEach((cb) => cb(channelId));
  }, []);

  // Flush pending logs
  const flushPendingLogs = useCallback(async () => {
    if (isFlushing.current) { flushTimeoutRef.current = null; return; }

    const allPending = Array.from(pendingLogsRef.current.entries());
    if (allPending.every(([, logs]) => logs.length === 0)) return;

    isFlushing.current = true;
    flushTimeoutRef.current = null;

    try {
      for (const [channelId, logs] of allPending) {
        if (logs.length === 0) continue;
        pendingLogsRef.current.set(channelId, []);

        if (persistLogsRef.current) {
          await insertLogs(logs);
          setTotalCount((prev) => prev + logs.length);
        }
        notifyNewLogs(logs, channelId);
      }
    } catch (e) {
      console.error('Failed to flush logs:', e);
    } finally {
      isFlushing.current = false;
      const hasMoreLogs = Array.from(pendingLogsRef.current.values()).some(logs => logs.length > 0);
      if (hasMoreLogs) scheduleFlush();
    }
  }, [notifyNewLogs, scheduleFlush]);

  useEffect(() => { flushPendingLogsRef.current = flushPendingLogs; }, [flushPendingLogs]);

  // Queue logs
  const queueLogs = useCallback(
    (logs: LogEntry[], channelId: string) => {
      const existing = pendingLogsRef.current.get(channelId) || [];
      pendingLogsRef.current.set(channelId, [...existing, ...logs]);
      scheduleFlush();
    },
    [scheduleFlush]
  );

  // Process a log entry
  const processEntry = useCallback(
    async (entry: LogEntry): Promise<LogEntry> => {
      return entry;
    },
    []
  );

  useEffect(() => { processEntryRef.current = processEntry; }, [processEntry]);

  // Start SSE connection for a channel
  const startPolling = useCallback(
    (channelId: string, channelName: string) => {
      debug('startPolling', { channelId, channelName });

      setChannels((prev) =>
        prev.map((ch) =>
          ch.id === channelId
            ? { ...ch, isConnected: true, isConnecting: false, connectionError: null }
            : ch
        )
      );

      const params = new URLSearchParams({ channel: channelName });
      const url = `${API_BASE}/stream?${params}`;
      
      const es = new EventSource(url);
      
      es.addEventListener('logs', async (e) => {
        if (isPausedRef.current) return;
        try {
          const newLogs: LogEntry[] = JSON.parse(e.data);
          if (newLogs.length > 0) {
            const processed = await Promise.all(
              newLogs.map((log) => processEntryRef.current?.(log) ?? Promise.resolve(log))
            );
            queueLogs(processed.filter((p): p is LogEntry => p !== undefined), channelId);
          }
        } catch (err) {
          console.error('Failed to parse SSE logs:', err);
        }
      });
      
      es.addEventListener('clear', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.channel === channelName || data.channel === 'all') {
            notifyClear(channelId);
          }
        } catch (err) {}
      });

      es.onerror = () => {
        setChannels((prev) =>
          prev.map((ch) =>
            ch.id === channelId
              ? { ...ch, isConnected: false, isConnecting: true }
              : ch
          )
        );
      };

      es.onopen = () => {
        setChannels((prev) =>
          prev.map((ch) =>
            ch.id === channelId
              ? { ...ch, isConnected: true, isConnecting: false }
              : ch
          )
        );
      };

      eventSourcesRef.current.set(channelId, es);
    },
    [queueLogs, notifyClear]
  );

  // Stop polling for a channel
  const stopPolling = useCallback((channelId: string) => {
    const es = eventSourcesRef.current.get(channelId);
    if (es) { 
      es.close(); 
      eventSourcesRef.current.delete(channelId); 
    }
    lastLogIdsRef.current.delete(channelId);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourcesRef.current.forEach((es) => es.close());
      eventSourcesRef.current.clear();
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
    };
  }, []);

  // Add a new channel
  const addChannel = useCallback((name: string) => {
    const id = generateId();
    pendingLogsRef.current.set(id, []);

    setChannels((prev) => [...prev, {
      id, name,
      isConnected: false, isConnecting: true, connectionError: null,
    }]);
    setActiveChannelId(id);
    startPolling(id, name);
  }, [startPolling]);

  // Remove a channel
  const removeChannel = useCallback((id: string) => {
    stopPolling(id);
    pendingLogsRef.current.delete(id);

    setChannels((prev) => {
      const newChannels = prev.filter((ch) => ch.id !== id);
      if (newChannels.length > 0) { setActiveChannelId(newChannels[0].id); }
      else { setActiveChannelId(null); }
      return newChannels;
    });
  }, [stopPolling]);


  // Clear logs for a channel
  const clearChannelLogs = useCallback(
    async (channelId: string) => {
      const channel = channelsRef.current.find((ch) => ch.id === channelId);
      if (!channel) return;

      await clearLogsForChannel(channel.name);
      const count = await getLogCount();
      setTotalCount(count);
      setChannels((prev) => prev.map((ch) => ch.id === channelId ? { ...ch } : ch));
      notifyClear(channelId);
      lastLogIdsRef.current.delete(channelId);
      fetch(`/api/logs?channel=${encodeURIComponent(channel.name)}`, { method: 'DELETE' }).catch(console.error);
    },
    [notifyClear]
  );

  // Subscribe to new log notifications
  const onNewLogs = useCallback(
    (callback: (logs: LogEntry[], channelId: string) => void) => {
      newLogsCallbacks.current.add(callback);
      return () => { newLogsCallbacks.current.delete(callback); };
    },
    []
  );

  // Subscribe to clear notifications
  const onClear = useCallback((callback: (channelId: string) => void) => {
    clearCallbacks.current.add(callback);
    return () => { clearCallbacks.current.delete(callback); };
  }, []);

  return {
    channels, activeChannelId, setActiveChannelId, addChannel, removeChannel,
    isInitialized, totalCount, clearChannelLogs,
    onNewLogs, onClear, persistLogs, setPersistLogs, isPaused, setIsPaused,
  };
}
