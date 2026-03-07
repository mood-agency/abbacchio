import { useState, useEffect, useRef, useCallback } from 'react';
import type { LogEntry, LogLevelLabel } from '../types';
import { decryptLog, isCryptoAvailable } from '../lib/crypto';
import { useSecureStorage } from '../contexts/SecureStorageContext';
import {
  initDatabase,
  insertLogs,
  clearLogsForChannel,
  getLogCount,
  updateLogs,
  requestPersistence,
  hasEncryptedLogs as checkHasEncryptedLogs,
  getLogsNeedingDecryption,
} from '../lib/sqlite-db';

// Debug logging - enable in browser console: window.__DEBUG_CHANNEL_MANAGER__ = true
const debug = (...args: unknown[]) => {
  if ((window as unknown as { __DEBUG_CHANNEL_MANAGER__?: boolean }).__DEBUG_CHANNEL_MANAGER__) {
    console.log('[ChannelManager]', ...args);
  }
};

const LOG_LEVELS: Record<number, LogLevelLabel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export interface ChannelConfig {
  id: string;
  name: string;
  secretKey: string;
}

export interface ChannelState {
  id: string;
  name: string;
  secretKey: string;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  hasEncryptedLogs: boolean;
}

export interface UseChannelManagerResult {
  /** List of connected channels */
  channels: ChannelState[];
  /** Currently active channel ID */
  activeChannelId: string | null;
  /** Set active channel */
  setActiveChannelId: (id: string) => void;
  /** Add a new channel connection */
  addChannel: (name: string, secretKey?: string) => void;
  /** Remove a channel connection */
  removeChannel: (id: string) => void;
  /** Update channel's secret key */
  updateChannelKey: (id: string, secretKey: string) => void;
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

// Cache initial URL params (read once before React StrictMode double-invocation)
// SECURITY: ?key= parameter removed - keys should only be entered manually
const initialUrlParams = (() => {
  const params = new URLSearchParams(window.location.search);
  const channel = params.get('channel') || '';

  // Remove any key parameter from URL immediately for security
  if (params.has('key')) {
    params.delete('key');
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
    console.warn('[Security] Encryption keys should not be passed via URL. The key parameter has been removed.');
  }

  return { channel };
})();

const API_BASE = '/api';
const POLL_INTERVAL = 1000;

export function useChannelManager(): UseChannelManagerResult {
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [activeChannelId, setActiveChannelIdInternal] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [persistLogs, setPersistLogs] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  // Use secure storage context for encrypted persistence
  const { isReady, initialChannels, saveChannels } = useSecureStorage();

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
        params.delete('key');
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
      params.delete('key');
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, [activeChannelId, channels]);

  // Refs
  const secretKeysRef = useRef<Map<string, string>>(new Map());
  const channelsRef = useRef<ChannelState[]>([]);
  const initializedRef = useRef(false);
  const processEntryRef = useRef<typeof processEntry | null>(null);

  // Polling refs
  const lastLogIdsRef = useRef<Map<string, string>>(new Map());
  const pollIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

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

    const configs = channels.map((ch) => ({ id: ch.id, name: ch.name, secretKey: ch.secretKey }));
    saveChannels(configs).catch((e) => {
      console.error('[ChannelManager] Failed to save channels:', e);
    });
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
    if (!isReady) return;
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
        secretKeysRef.current.set(config.id, config.secretKey);
        pendingLogsRef.current.set(config.id, []);
        return {
          id: config.id, name: config.name, secretKey: config.secretKey,
          isConnected: false, isConnecting: true, connectionError: null, hasEncryptedLogs: false,
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
          secretKeysRef.current.set(id, '');
          pendingLogsRef.current.set(id, []);
          channelStates.push({
            id, name: initialUrlParams.channel, secretKey: '',
            isConnected: false, isConnecting: true, connectionError: null, hasEncryptedLogs: false,
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
  }, [isReady, initialChannels]);

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

  // Process a log entry (decrypt if needed)
  const processEntry = useCallback(
    async (entry: LogEntry, channelId: string, skipStateUpdate = false): Promise<LogEntry> => {
      if (!entry.encrypted || !entry.encryptedData) {
        return { ...entry, wasEncrypted: false };
      }

      const key = secretKeysRef.current.get(channelId) || '';
      if (!key || !isCryptoAvailable()) {
        if (!skipStateUpdate) {
          setChannels((prev) => prev.map((ch) => ch.id === channelId ? { ...ch, hasEncryptedLogs: true } : ch));
        }
        return { ...entry, wasEncrypted: true, decryptionFailed: !key };
      }

      try {
        const decrypted = await decryptLog<{
          level?: number; time?: number; msg?: string; message?: string;
          namespace?: string; name?: string; [key: string]: unknown;
        }>(entry.encryptedData, key);

        if (!decrypted) {
          if (!skipStateUpdate) {
            setChannels((prev) => prev.map((ch) => ch.id === channelId ? { ...ch, hasEncryptedLogs: true } : ch));
          }
          return { ...entry, wasEncrypted: true, decryptionFailed: true };
        }

        const level = typeof decrypted.level === 'number' ? decrypted.level : 30;
        const { level: _, time, msg, message, namespace, name, ...rest } = decrypted;

        return {
          ...entry, level,
          levelLabel: LOG_LEVELS[level as keyof typeof LOG_LEVELS] || 'info',
          time: time || entry.time, msg: msg || message || '',
          namespace: namespace || name, data: rest,
          encrypted: false, encryptedData: undefined, wasEncrypted: true,
        };
      } catch {
        if (!skipStateUpdate) {
          setChannels((prev) => prev.map((ch) => ch.id === channelId ? { ...ch, hasEncryptedLogs: true } : ch));
        }
        return { ...entry, wasEncrypted: true, decryptionFailed: true };
      }
    },
    []
  );

  useEffect(() => { processEntryRef.current = processEntry; }, [processEntry]);

  // Start HTTP polling for a channel
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

      const poll = async () => {
        if (isPausedRef.current) return;

        try {
          const params = new URLSearchParams({ channel: channelName });
          const lastId = lastLogIdsRef.current.get(channelId);
          if (lastId) params.set('afterId', lastId);

          const res = await fetch(`${API_BASE}/logs?${params}`);
          if (!res.ok) return;
          const data = await res.json();
          const newLogs: LogEntry[] = data.logs || [];

          if (newLogs.length > 0) {
            lastLogIdsRef.current.set(channelId, newLogs[newLogs.length - 1].id);

            const processed = await Promise.all(
              newLogs.map((log) => processEntryRef.current?.(log, channelId) ?? Promise.resolve(log))
            );
            queueLogs(processed.filter((p): p is LogEntry => p !== undefined), channelId);
          }
        } catch (err) {
          console.error(`Failed to poll logs for channel ${channelName}:`, err);
        }
      };

      poll();
      const interval = setInterval(poll, POLL_INTERVAL);
      pollIntervalsRef.current.set(channelId, interval);
    },
    [queueLogs]
  );

  // Stop polling for a channel
  const stopPolling = useCallback((channelId: string) => {
    const interval = pollIntervalsRef.current.get(channelId);
    if (interval) { clearInterval(interval); pollIntervalsRef.current.delete(channelId); }
    lastLogIdsRef.current.delete(channelId);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pollIntervalsRef.current.forEach((interval) => clearInterval(interval));
      pollIntervalsRef.current.clear();
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
    };
  }, []);

  // Add a new channel
  const addChannel = useCallback((name: string, secretKey = '') => {
    const id = generateId();
    secretKeysRef.current.set(id, secretKey);
    pendingLogsRef.current.set(id, []);

    setChannels((prev) => [...prev, {
      id, name, secretKey,
      isConnected: false, isConnecting: true, connectionError: null, hasEncryptedLogs: false,
    }]);
    setActiveChannelId(id);
    startPolling(id, name);
  }, [startPolling]);

  // Remove a channel
  const removeChannel = useCallback((id: string) => {
    stopPolling(id);
    secretKeysRef.current.delete(id);
    pendingLogsRef.current.delete(id);

    setChannels((prev) => {
      const newChannels = prev.filter((ch) => ch.id !== id);
      if (newChannels.length > 0) { setActiveChannelId(newChannels[0].id); }
      else { setActiveChannelId(null); }
      return newChannels;
    });
  }, [stopPolling]);

  // Update channel's secret key
  const updateChannelKey = useCallback(
    async (id: string, secretKey: string) => {
      secretKeysRef.current.set(id, secretKey);
      setChannels((prev) => prev.map((ch) => (ch.id === id ? { ...ch, secretKey } : ch)));

      const channel = channelsRef.current.find((ch) => ch.id === id);
      if (!channel || !secretKey) return;

      const logsNeedingDecryption = await getLogsNeedingDecryption(channel.name);
      if (logsNeedingDecryption.length === 0) return;

      const BATCH_SIZE = 50;
      const logsToUpdate: LogEntry[] = [];

      for (let i = 0; i < logsNeedingDecryption.length; i += BATCH_SIZE) {
        const batch = logsNeedingDecryption.slice(i, i + BATCH_SIZE);
        const processed = await Promise.all(
          batch.map((log) => processEntry({ ...log, encrypted: true, decryptionFailed: false }, id, true))
        );
        logsToUpdate.push(...processed);
        if (i + BATCH_SIZE < logsNeedingDecryption.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      if (logsToUpdate.length > 0) {
        await updateLogs(logsToUpdate);
        notifyNewLogs([], id);
      }

      const hasEncrypted = await checkHasEncryptedLogs(channel.name);
      setChannels((prev) => prev.map((ch) => (ch.id === id ? { ...ch, hasEncryptedLogs: hasEncrypted } : ch)));
    },
    [processEntry, notifyNewLogs]
  );

  // Clear logs for a channel
  const clearChannelLogs = useCallback(
    async (channelId: string) => {
      const channel = channelsRef.current.find((ch) => ch.id === channelId);
      if (!channel) return;

      await clearLogsForChannel(channel.name);
      const count = await getLogCount();
      setTotalCount(count);
      setChannels((prev) => prev.map((ch) => ch.id === channelId ? { ...ch, hasEncryptedLogs: false } : ch));
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
    updateChannelKey, isInitialized, totalCount, clearChannelLogs,
    onNewLogs, onClear, persistLogs, setPersistLogs, isPaused, setIsPaused,
  };
}
