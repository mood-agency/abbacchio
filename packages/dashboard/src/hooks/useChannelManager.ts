import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import type { LogEntry, LogLevelLabel } from '../types';
import { decryptLog, isCryptoAvailable } from '../lib/crypto';
import { useSecureStorage } from '../contexts/SecureStorageContext';

// Debug logging - enable in browser console: window.__DEBUG_CHANNEL_MANAGER__ = true
const debug = (...args: unknown[]) => {
  if ((window as unknown as { __DEBUG_CHANNEL_MANAGER__?: boolean }).__DEBUG_CHANNEL_MANAGER__) {
    console.log('[ChannelManager]', ...args);
  }
};
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

// Note: Storage is now handled by SecureStorageContext
// This hook receives initial channels from the context and saves through callbacks

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
      // No active channel - remove channel from URL
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

    // Only update if channel name changed
    if (currentChannel !== channel.name) {
      params.set('channel', channel.name);
      // Don't include key in URL for security
      params.delete('key');
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, [activeChannelId, channels]);

  // Refs for managing connections
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const reconnectTimeoutsRef = useRef<Map<string, number>>(new Map());
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const secretKeysRef = useRef<Map<string, string>>(new Map());
  const lastPingRef = useRef<Map<string, number>>(new Map());
  const pingCheckIntervalsRef = useRef<Map<string, number>>(new Map());
  // If no ping received in this time, consider connection dead (2x server heartbeat interval)
  const PING_TIMEOUT_MS = 130000; // ~2 minutes (server sends every 60s)
  // Ref to track channels without causing re-renders (fixes closure issues in connectChannel)
  const channelsRef = useRef<ChannelState[]>([]);
  // Prevent double initialization in React StrictMode
  const initializedRef = useRef(false);

  // Callbacks for subscribers
  const newLogsCallbacks = useRef<Set<(logs: LogEntry[], channelId: string) => void>>(new Set());
  const clearCallbacks = useRef<Set<(channelId: string) => void>>(new Set());

  // Batching: accumulate logs and flush periodically (per channel)
  const pendingLogsRef = useRef<Map<string, LogEntry[]>>(new Map());
  const flushTimeoutRef = useRef<number | null>(null);
  const isFlushing = useRef(false);
  const persistLogsRef = useRef(persistLogs);
  const isPausedRef = useRef(isPaused);
  const BATCH_INTERVAL_MS = 100;
  // Ref to always call the latest flushPendingLogs (survives HMR)
  const flushPendingLogsRef = useRef<() => void>(() => {});

  // Keep refs in sync
  useEffect(() => {
    persistLogsRef.current = persistLogs;
  }, [persistLogs]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  // Sync channels to secure storage whenever they change
  // Only save after database is initialized to prevent overwriting with empty array on mount
  useEffect(() => {
    debug('Sync effect triggered:', { isInitialized, channelsCount: channels.length });
    // Don't save until database is initialized
    if (!isInitialized) {
      debug('Skipping save - not initialized yet');
      return;
    }

    // Save to secure storage (encrypted with master password)
    const configs = channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      secretKey: ch.secretKey
    }));
    saveChannels(configs).catch((e) => {
      console.error('[ChannelManager] Failed to save channels:', e);
    });
  }, [channels, isInitialized, saveChannels]);

  // Schedule flush using ref (survives HMR and callback recreation)
  const scheduleFlush = useCallback(() => {
    if (flushTimeoutRef.current === null) {
      flushTimeoutRef.current = window.setTimeout(() => {
        flushPendingLogsRef.current();
      }, BATCH_INTERVAL_MS);
    }
  }, []);

  // Initialize database and load saved channels
  useEffect(() => {
    // Prevent double initialization in React StrictMode
    if (initializedRef.current) return;
    // Wait for secure storage to be ready (unlocked or no persistence)
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

      // Load channels from secure storage (already decrypted by SecureStorageContext)
      const channelStates: ChannelState[] = initialChannels.map((config) => {
        secretKeysRef.current.set(config.id, config.secretKey);
        pendingLogsRef.current.set(config.id, []);
        return {
          id: config.id,
          name: config.name,
          secretKey: config.secretKey,
          isConnected: false,
          isConnecting: true,
          connectionError: null,
          hasEncryptedLogs: false,
        };
      });

      // Check if URL has a channel param
      let activeId: string | null = null;
      if (initialUrlParams.channel) {
        // Check if channel already exists in saved channels
        const existingChannel = channelStates.find(
          (ch) => ch.name === initialUrlParams.channel
        );
        if (existingChannel) {
          // Channel exists - just set it as active
          // SECURITY: Keys are no longer accepted from URL
          activeId = existingChannel.id;
          debug('URL channel found in saved channels:', existingChannel.name);
        } else {
          // Channel doesn't exist - add it (without key - user must enter manually)
          const id = generateId();
          const channelName = initialUrlParams.channel;
          secretKeysRef.current.set(id, ''); // Empty key - user must enter manually
          pendingLogsRef.current.set(id, []);
          const newChannel: ChannelState = {
            id,
            name: channelName,
            secretKey: '', // Empty - user enters via UI
            isConnected: false,
            isConnecting: true,
            connectionError: null,
            hasEncryptedLogs: false,
          };
          channelStates.push(newChannel);
          activeId = id;
          debug('URL channel added:', channelName);
        }
      }

      // Set channels and connect
      if (channelStates.length > 0) {
        setChannels(channelStates);
        setActiveChannelId(activeId || channelStates[0].id);
        // Connect all channels
        channelStates.forEach((ch) => {
          connectChannel(ch.id, ch.name);
        });
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, initialChannels]);

  // Notify subscribers of new logs
  const notifyNewLogs = useCallback((logs: LogEntry[], channelId: string) => {
    newLogsCallbacks.current.forEach((cb) => cb(logs, channelId));
  }, []);

  // Notify subscribers of clear
  const notifyClear = useCallback((channelId: string) => {
    clearCallbacks.current.forEach((cb) => cb(channelId));
  }, []);

  // Flush pending logs
  const flushPendingLogs = useCallback(async () => {
    debug('flushPendingLogs called', { isFlushing: isFlushing.current });
    if (isFlushing.current) {
      debug('flushPendingLogs SKIP - already flushing');
      // Clear the ref so a new timeout can be scheduled (by queueLogs or the active flush's finally block)
      flushTimeoutRef.current = null;
      return;
    }

    const allPending = Array.from(pendingLogsRef.current.entries());
    if (allPending.every(([, logs]) => logs.length === 0)) {
      debug('flushPendingLogs SKIP - no pending logs');
      return;
    }

    isFlushing.current = true;
    flushTimeoutRef.current = null;
    debug('flushPendingLogs START', { channelCount: allPending.length });

    try {
      for (const [channelId, logs] of allPending) {
        if (logs.length === 0) continue;
        pendingLogsRef.current.set(channelId, []);
        debug('flushPendingLogs processing channel', { channelId, logCount: logs.length });

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
      // Check if more logs accumulated during the flush and schedule another flush
      const hasMoreLogs = Array.from(pendingLogsRef.current.values()).some(logs => logs.length > 0);
      debug('flushPendingLogs DONE', { hasMoreLogs });
      if (hasMoreLogs) {
        scheduleFlush();
      }
    }
  }, [notifyNewLogs, scheduleFlush]);

  // Keep flushPendingLogsRef in sync (so scheduled timeouts always call latest version)
  useEffect(() => {
    flushPendingLogsRef.current = flushPendingLogs;
  }, [flushPendingLogs]);

  // Queue logs for batched processing
  const queueLogs = useCallback(
    (logs: LogEntry[], channelId: string) => {
      const existing = pendingLogsRef.current.get(channelId) || [];
      pendingLogsRef.current.set(channelId, [...existing, ...logs]);
      debug('queueLogs', { channelId, newLogs: logs.length, totalPending: existing.length + logs.length, hasTimeout: flushTimeoutRef.current !== null });

      scheduleFlush();
    },
    [scheduleFlush]
  );

  // Process a log entry (decrypt if needed)
  // skipStateUpdate: when true, don't call setChannels (used for batch re-decryption)
  const processEntry = useCallback(
    async (entry: LogEntry, channelId: string, skipStateUpdate = false): Promise<LogEntry> => {
      if (!entry.encrypted || !entry.encryptedData) {
        return { ...entry, wasEncrypted: false };
      }

      const key = secretKeysRef.current.get(channelId) || '';
      if (!key || !isCryptoAvailable()) {
        if (!skipStateUpdate) {
          setChannels((prev) =>
            prev.map((ch) =>
              ch.id === channelId ? { ...ch, hasEncryptedLogs: true } : ch
            )
          );
        }
        return { ...entry, wasEncrypted: true, decryptionFailed: !key };
      }

      try {
        const decrypted = await decryptLog<{
          level?: number;
          time?: number;
          msg?: string;
          message?: string;
          namespace?: string;
          name?: string;
          [key: string]: unknown;
        }>(entry.encryptedData, key);

        if (!decrypted) {
          if (!skipStateUpdate) {
            setChannels((prev) =>
              prev.map((ch) =>
                ch.id === channelId ? { ...ch, hasEncryptedLogs: true } : ch
              )
            );
          }
          return { ...entry, wasEncrypted: true, decryptionFailed: true };
        }

        const level = typeof decrypted.level === 'number' ? decrypted.level : 30;
        const { level: _, time, msg, message, namespace, name, ...rest } = decrypted;

        return {
          ...entry,
          level,
          levelLabel: LOG_LEVELS[level as keyof typeof LOG_LEVELS] || 'info',
          time: time || entry.time,
          msg: msg || message || '',
          namespace: namespace || name,
          data: rest,
          encrypted: false,
          encryptedData: undefined,
          wasEncrypted: true,
        };
      } catch {
        if (!skipStateUpdate) {
          setChannels((prev) =>
            prev.map((ch) =>
              ch.id === channelId ? { ...ch, hasEncryptedLogs: true } : ch
            )
          );
        }
        return { ...entry, wasEncrypted: true, decryptionFailed: true };
      }
    },
    []
  );

  // Connect to a channel's SSE stream
  const connectChannel = useCallback(
    async (channelId: string, channelName: string) => {
      debug('connectChannel called', { channelId, channelName });
      // Close existing connection and cleanup ping interval if any
      const existingSource = eventSourcesRef.current.get(channelId);
      if (existingSource) {
        debug('connectChannel closing existing connection');
        existingSource.close();
      }
      const existingPingInterval = pingCheckIntervalsRef.current.get(channelId);
      if (existingPingInterval) {
        clearInterval(existingPingInterval);
        pingCheckIntervalsRef.current.delete(channelId);
      }

      setChannels((prev) =>
        prev.map((ch) =>
          ch.id === channelId
            ? { ...ch, isConnecting: true, connectionError: null }
            : ch
        )
      );

      const streamUrl = `/api/logs/stream?channel=${encodeURIComponent(channelName)}`;

      // Pre-check connection availability before establishing SSE
      try {
        const checkResponse = await fetch(streamUrl, { method: 'HEAD' });
        if (checkResponse.status === 503) {
          // Try to get error details from a GET request
          const errorResponse = await fetch(streamUrl);
          const errorData = await errorResponse.json().catch(() => ({}));
          const errorMessage = errorData.message || 'Connection limit reached';

          console.warn(`[SSE] Connection rejected for channel "${channelName}":`, errorMessage);
          toast.error(`Channel "${channelName}": ${errorMessage}`);

          setChannels((prev) =>
            prev.map((ch) =>
              ch.id === channelId
                ? { ...ch, isConnecting: false, isConnected: false, connectionError: errorMessage }
                : ch
            )
          );
          return;
        }
      } catch {
        // HEAD check failed, proceed with SSE anyway (might work)
        debug('HEAD check failed, proceeding with SSE connection');
      }

      const eventSource = new EventSource(streamUrl);
      eventSourcesRef.current.set(channelId, eventSource);

      // Initialize last ping time
      lastPingRef.current.set(channelId, Date.now());

      eventSource.onopen = () => {
        debug('SSE onopen', { channelId, channelName });
        setChannels((prev) =>
          prev.map((ch) =>
            ch.id === channelId
              ? { ...ch, isConnected: true, isConnecting: false, connectionError: null }
              : ch
          )
        );
        reconnectAttemptsRef.current.set(channelId, 0);
        lastPingRef.current.set(channelId, Date.now());

        // Start ping check interval
        const pingCheckInterval = window.setInterval(() => {
          const lastPing = lastPingRef.current.get(channelId) || 0;
          const timeSinceLastPing = Date.now() - lastPing;
          debug('ping check', { channelId, timeSinceLastPing, timeout: PING_TIMEOUT_MS });

          if (timeSinceLastPing > PING_TIMEOUT_MS) {
            debug('ping timeout - connection dead, forcing reconnect', { channelId });
            // Connection is dead, force reconnect
            eventSource.close();
            eventSourcesRef.current.delete(channelId);
            clearInterval(pingCheckInterval);
            pingCheckIntervalsRef.current.delete(channelId);

            setChannels((prev) =>
              prev.map((ch) =>
                ch.id === channelId
                  ? { ...ch, isConnected: false, connectionError: 'Connection lost, reconnecting...' }
                  : ch
              )
            );

            // Reconnect immediately
            const channel = channelsRef.current.find((ch) => ch.id === channelId);
            if (channel) {
              connectChannel(channelId, channelName);
            }
          }
        }, 30000); // Check every 30 seconds
        pingCheckIntervalsRef.current.set(channelId, pingCheckInterval);
      };

      // Listen for ping events (server heartbeat)
      eventSource.addEventListener('ping', () => {
        debug('SSE ping received', { channelId, channelName });
        lastPingRef.current.set(channelId, Date.now());
      });

      eventSource.addEventListener('log', async (event) => {
        debug('SSE log event received', { channelId, channelName, isPaused: isPausedRef.current });
        // Any event means connection is alive
        lastPingRef.current.set(channelId, Date.now());
        // Skip processing if paused
        if (isPausedRef.current) return;
        try {
          const entry: LogEntry = JSON.parse(event.data);
          const processed = await processEntry(entry, channelId);
          queueLogs([processed], channelId);
        } catch (e) {
          console.error('Failed to parse log event:', e);
        }
      });

      eventSource.addEventListener('batch', async (event) => {
        debug('SSE batch event received', { channelId, channelName, isPaused: isPausedRef.current });
        // Any event means connection is alive
        lastPingRef.current.set(channelId, Date.now());
        // Skip processing if paused
        if (isPausedRef.current) return;
        try {
          const entries: LogEntry[] = JSON.parse(event.data);
          const processed = await Promise.all(
            entries.map((entry) => processEntry(entry, channelId))
          );
          queueLogs(processed, channelId);
        } catch (e) {
          console.error('Failed to parse batch event:', e);
        }
      });

      eventSource.onerror = () => {
        debug('SSE onerror', { channelId, channelName });
        // Clear ping check interval
        const pingInterval = pingCheckIntervalsRef.current.get(channelId);
        if (pingInterval) {
          clearInterval(pingInterval);
          pingCheckIntervalsRef.current.delete(channelId);
        }

        setChannels((prev) =>
          prev.map((ch) =>
            ch.id === channelId
              ? { ...ch, isConnected: false, isConnecting: false }
              : ch
          )
        );
        eventSource.close();
        // Remove from map so connection effect can reconnect if needed
        eventSourcesRef.current.delete(channelId);

        const attempts = reconnectAttemptsRef.current.get(channelId) || 0;
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
        reconnectAttemptsRef.current.set(channelId, attempts + 1);

        setChannels((prev) =>
          prev.map((ch) =>
            ch.id === channelId
              ? { ...ch, connectionError: `Reconnecting in ${delay / 1000}s...` }
              : ch
          )
        );

        const timeout = window.setTimeout(() => {
          // Check if channel still exists before reconnecting (use ref to avoid stale closure)
          const channel = channelsRef.current.find((ch) => ch.id === channelId);
          if (channel) {
            connectChannel(channelId, channelName);
          }
        }, delay);
        reconnectTimeoutsRef.current.set(channelId, timeout);
      };
    },
    [processEntry, queueLogs]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourcesRef.current.forEach((es) => es.close());
      reconnectTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      pingCheckIntervalsRef.current.forEach((interval) => clearInterval(interval));
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
    };
  }, []);

  // Add a new channel
  const addChannel = useCallback((name: string, secretKey = '') => {
    const id = generateId();
    secretKeysRef.current.set(id, secretKey);
    pendingLogsRef.current.set(id, []);

    const newChannel: ChannelState = {
      id,
      name,
      secretKey,
      isConnected: false,
      isConnecting: true,
      connectionError: null,
      hasEncryptedLogs: false,
    };

    setChannels((prev) => [...prev, newChannel]);
    setActiveChannelId(id);
    // Connect directly instead of via effect
    connectChannel(id, name);
  }, [connectChannel]);

  // Remove a channel
  const removeChannel = useCallback((id: string) => {
    // Get channel name before removing (for API call)
    const channel = channelsRef.current.find((ch) => ch.id === id);
    const channelName = channel?.name;

    // Signal server to close SSE connection (fire and forget)
    if (channelName) {
      fetch(`/api/logs/disconnect?channel=${encodeURIComponent(channelName)}`, {
        method: 'POST',
      }).catch(() => {
        // Ignore errors - server will cleanup eventually
      });
    }

    // Close SSE connection locally
    const eventSource = eventSourcesRef.current.get(id);
    if (eventSource) {
      eventSource.close();
      eventSourcesRef.current.delete(id);
    }

    // Clear reconnect timeout
    const timeout = reconnectTimeoutsRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      reconnectTimeoutsRef.current.delete(id);
    }

    // Clear ping check interval
    const pingInterval = pingCheckIntervalsRef.current.get(id);
    if (pingInterval) {
      clearInterval(pingInterval);
      pingCheckIntervalsRef.current.delete(id);
    }

    // Clean up refs
    secretKeysRef.current.delete(id);
    reconnectAttemptsRef.current.delete(id);
    pendingLogsRef.current.delete(id);
    lastPingRef.current.delete(id);

    setChannels((prev) => {
      const newChannels = prev.filter((ch) => ch.id !== id);
      // If removing active channel, switch to another
      if (newChannels.length > 0) {
        setActiveChannelId(newChannels[0].id);
      } else {
        setActiveChannelId(null);
      }
      return newChannels;
    });
  }, []);

  // Update channel's secret key
  const updateChannelKey = useCallback(
    async (id: string, secretKey: string) => {
      debug('updateChannelKey START', { id, hasKey: !!secretKey });
      secretKeysRef.current.set(id, secretKey);
      setChannels((prev) =>
        prev.map((ch) => (ch.id === id ? { ...ch, secretKey } : ch))
      );

      // Re-decrypt logs for this channel (use ref to avoid stale closure)
      const channel = channelsRef.current.find((ch) => ch.id === id);
      if (!channel || !secretKey) {
        debug('updateChannelKey SKIP - no channel or key');
        return;
      }

      debug('updateChannelKey getting logs needing decryption');
      const logsNeedingDecryption = await getLogsNeedingDecryption(channel.name);
      debug('updateChannelKey logsNeedingDecryption:', logsNeedingDecryption.length);
      if (logsNeedingDecryption.length === 0) return;

      // Process logs in parallel batches to avoid blocking the event loop
      const BATCH_SIZE = 50;
      const logsToUpdate: LogEntry[] = [];

      for (let i = 0; i < logsNeedingDecryption.length; i += BATCH_SIZE) {
        debug('updateChannelKey processing batch', i, 'of', logsNeedingDecryption.length);
        const batch = logsNeedingDecryption.slice(i, i + BATCH_SIZE);
        const processed = await Promise.all(
          batch.map((log) =>
            processEntry(
              { ...log, encrypted: true, decryptionFailed: false },
              id,
              true // skipStateUpdate - we'll update state once at the end
            )
          )
        );
        logsToUpdate.push(...processed);

        // Yield to the event loop between batches to allow SSE events to be processed
        if (i + BATCH_SIZE < logsNeedingDecryption.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      debug('updateChannelKey updating logs:', logsToUpdate.length);
      if (logsToUpdate.length > 0) {
        await updateLogs(logsToUpdate);
        debug('updateChannelKey notifying');
        notifyNewLogs([], id);
      }

      // Update hasEncryptedLogs state once after all processing
      const hasEncrypted = await checkHasEncryptedLogs(channel.name);
      setChannels((prev) =>
        prev.map((ch) => (ch.id === id ? { ...ch, hasEncryptedLogs: hasEncrypted } : ch))
      );
      debug('updateChannelKey DONE');
    },
    [processEntry, notifyNewLogs]
  );

  // Clear logs for a channel
  const clearChannelLogs = useCallback(
    async (channelId: string) => {
      // Use ref to avoid stale closure
      const channel = channelsRef.current.find((ch) => ch.id === channelId);
      if (!channel) return;

      await clearLogsForChannel(channel.name);
      const count = await getLogCount();
      setTotalCount(count);
      setChannels((prev) =>
        prev.map((ch) =>
          ch.id === channelId ? { ...ch, hasEncryptedLogs: false } : ch
        )
      );
      notifyClear(channelId);
      fetch(`/api/logs?channel=${encodeURIComponent(channel.name)}`, {
        method: 'DELETE',
      }).catch(console.error);
    },
    [notifyClear]
  );

  // Subscribe to new log notifications
  const onNewLogs = useCallback(
    (callback: (logs: LogEntry[], channelId: string) => void) => {
      newLogsCallbacks.current.add(callback);
      return () => {
        newLogsCallbacks.current.delete(callback);
      };
    },
    []
  );

  // Subscribe to clear notifications
  const onClear = useCallback((callback: (channelId: string) => void) => {
    clearCallbacks.current.add(callback);
    return () => {
      clearCallbacks.current.delete(callback);
    };
  }, []);

  return {
    channels,
    activeChannelId,
    setActiveChannelId,
    addChannel,
    removeChannel,
    updateChannelKey,
    isInitialized,
    totalCount,
    clearChannelLogs,
    onNewLogs,
    onClear,
    persistLogs,
    setPersistLogs,
    isPaused,
    setIsPaused,
  };
}
