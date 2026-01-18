import { useState, useEffect, useRef, useCallback } from 'react';
import type { LogEntry, LogLevelLabel } from '../types';
import { decryptLog, isCryptoAvailable } from '../lib/crypto';
import {
  initDatabase,
  insertLogs,
  clearAllLogs,
  getLogCount,
  updateLogs,
  requestPersistence,
  hasEncryptedLogs as checkHasEncryptedLogs,
  getLogsNeedingDecryption,
} from '../lib/sqlite-db';
import { isTauri } from '../lib/tauri-centrifugo';

const LOG_LEVELS: Record<number, LogLevelLabel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export interface UseLogStoreResult {
  /** Total number of logs in database */
  totalCount: number;
  /** Whether database initialization is complete */
  isInitialized: boolean;
  /** Clear all logs */
  clearLogs: () => Promise<void>;
  /** Subscribe to new log notifications - callback receives the new logs */
  onNewLogs: (callback: (logs: LogEntry[]) => void) => () => void;
  /** Subscribe to clear notifications */
  onClear: (callback: () => void) => () => void;
  /** Connection status */
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  /** Encryption */
  secretKey: string;
  setSecretKey: (key: string) => void;
  hasEncryptedLogs: boolean;
  /** Channels */
  channels: string[];
  urlChannel: string;
  /** Persistence toggle */
  persistLogs: boolean;
  setPersistLogs: (persist: boolean) => void;
}

// Cache initial URL params (read once before React StrictMode double-invocation)
// Note: Secret key is kept in memory only for security - never persisted to storage
const initialUrlParams = (() => {
  const params = new URLSearchParams(window.location.search);
  const key = params.get('key') || '';
  const channel = params.get('channel') || '';

  // Remove key from URL immediately for security (keep channel)
  if (key) {
    params.delete('key');
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }

  return { channel, key };
})();

// Get Centrifugo WebSocket URL
function getCentrifugoUrl(): string {
  // In production, use the configured URL or derive from current host
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.VITE_CENTRIFUGO_URL || `${wsProtocol}//${window.location.hostname}:8000/connection/websocket`;
}

// Fetch Centrifugo token from API
async function fetchCentrifugoToken(): Promise<string> {
  const response = await fetch('/api/centrifugo/token');
  if (!response.ok) {
    throw new Error('Failed to fetch Centrifugo token');
  }
  const data = await response.json();
  return data.token;
}

export function useLogStore(): UseLogStoreResult {
  const [totalCount, setTotalCount] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  // Secret key is kept in memory only - never persisted for security
  const [secretKey, setSecretKey] = useState(initialUrlParams.key);
  const [channels, setChannels] = useState<string[]>(['default']);
  const [urlChannel] = useState(initialUrlParams.channel);
  const [hasEncryptedLogs, setHasEncryptedLogs] = useState(false);
  const [persistLogs, setPersistLogs] = useState(true);

  const workerRef = useRef<Worker | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const reconnectAttempts = useRef(0);
  const secretKeyRef = useRef(secretKey);
  const newLogsCallbacks = useRef<Set<(logs: LogEntry[]) => void>>(new Set());
  const clearCallbacks = useRef<Set<() => void>>(new Set());

  // Batching: accumulate logs and flush periodically
  const pendingLogsRef = useRef<LogEntry[]>([]);
  const flushTimeoutRef = useRef<number | null>(null);
  const isFlushing = useRef(false);
  const persistLogsRef = useRef(persistLogs);
  const BATCH_INTERVAL_MS = 100; // Flush every 100ms

  // Keep refs in sync
  useEffect(() => {
    secretKeyRef.current = secretKey;
  }, [secretKey]);

  useEffect(() => {
    persistLogsRef.current = persistLogs;
  }, [persistLogs]);

  // Initialize database and request persistence
  useEffect(() => {
    const init = async () => {
      await initDatabase();
      await requestPersistence();
      const count = await getLogCount();
      setTotalCount(count);

      // Check for encrypted logs on initial load
      if (count > 0) {
        const hasEncrypted = await checkHasEncryptedLogs();
        setHasEncryptedLogs(hasEncrypted);
      }
      setIsInitialized(true);
    };
    init();
  }, []);

  // Notify subscribers of new logs (internal - called by flush)
  const notifyNewLogs = useCallback((logs: LogEntry[]) => {
    newLogsCallbacks.current.forEach((cb) => cb(logs));
  }, []);

  // Notify subscribers of clear
  const notifyClear = useCallback(() => {
    clearCallbacks.current.forEach((cb) => cb());
  }, []);

  // Flush pending logs: write to SQLite (if enabled), update count, notify subscribers
  const flushPendingLogs = useCallback(async () => {
    if (pendingLogsRef.current.length === 0 || isFlushing.current) return;

    isFlushing.current = true;
    const logsToFlush = pendingLogsRef.current;
    pendingLogsRef.current = [];
    flushTimeoutRef.current = null;

    try {
      // Only write to SQLite if persistence is enabled
      if (persistLogsRef.current) {
        await insertLogs(logsToFlush);
        setTotalCount((prev) => prev + logsToFlush.length);
      }
      // Always notify subscribers for real-time display
      notifyNewLogs(logsToFlush);
    } catch (e) {
      console.error('Failed to flush logs:', e);
    } finally {
      isFlushing.current = false;
    }
  }, [notifyNewLogs]);

  // Queue logs for batched processing
  const queueLogs = useCallback(
    (logs: LogEntry[]) => {
      for (const log of logs) {
        pendingLogsRef.current.push(log);
      }

      // Schedule flush if not already scheduled
      if (flushTimeoutRef.current === null) {
        flushTimeoutRef.current = window.setTimeout(
          flushPendingLogs,
          BATCH_INTERVAL_MS
        );
      }
    },
    [flushPendingLogs]
  );

  // Subscribe to new log notifications
  const onNewLogs = useCallback((callback: (logs: LogEntry[]) => void) => {
    newLogsCallbacks.current.add(callback);
    return () => {
      newLogsCallbacks.current.delete(callback);
    };
  }, []);

  // Subscribe to clear notifications
  const onClear = useCallback((callback: () => void) => {
    clearCallbacks.current.add(callback);
    return () => {
      clearCallbacks.current.delete(callback);
    };
  }, []);

  // Process a log entry (decrypt if needed)
  const processEntry = useCallback(
    async (entry: LogEntry): Promise<LogEntry> => {
      // Non-encrypted: return as-is (wasEncrypted stays false/undefined)
      if (!entry.encrypted || !entry.encryptedData) {
        return { ...entry, wasEncrypted: false };
      }

      // Mark as originally encrypted
      const key = secretKeyRef.current;
      if (!key || !isCryptoAvailable()) {
        setHasEncryptedLogs(true);
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
          setHasEncryptedLogs(true);
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
          wasEncrypted: true, // Preserve that it was originally encrypted
        };
      } catch {
        setHasEncryptedLogs(true);
        return { ...entry, wasEncrypted: true, decryptionFailed: true };
      }
    },
    []
  );

  // Re-decrypt logs when secret key changes
  useEffect(() => {
    if (!secretKey) return;

    const decryptExisting = async () => {
      const logsNeedingDecryption = await getLogsNeedingDecryption();
      if (logsNeedingDecryption.length === 0) return;

      const logsToUpdate: LogEntry[] = [];

      for (const log of logsNeedingDecryption) {
        const processed = await processEntry({
          ...log,
          encrypted: true,
          decryptionFailed: false,
        });
        logsToUpdate.push(processed);
      }

      if (logsToUpdate.length > 0) {
        await updateLogs(logsToUpdate);
        // Notify with empty array to trigger refresh
        notifyNewLogs([]);
      }

      // Update hasEncryptedLogs status
      const hasEncrypted = await checkHasEncryptedLogs();
      setHasEncryptedLogs(hasEncrypted);
    };

    decryptExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretKey]);

  // Handle Centrifugo publication data
  const handlePublication = useCallback(
    async (data: unknown) => {
      if (!data || typeof data !== 'object') return;

      const publication = data as { type: string; data: LogEntry | LogEntry[] };

      if (publication.type === 'log' && publication.data) {
        const entry = publication.data as LogEntry;
        const processed = await processEntry(entry);
        queueLogs([processed]);
      } else if (publication.type === 'batch' && Array.isArray(publication.data)) {
        const entries = publication.data as LogEntry[];
        const processed = await Promise.all(entries.map(processEntry));
        queueLogs(processed);
      }
    },
    [processEntry, queueLogs]
  );

  // Schedule reconnection with exponential backoff
  const scheduleReconnect = useCallback(() => {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
    reconnectAttempts.current++;
    setConnectionError(`Connection lost. Reconnecting in ${delay / 1000}s...`);

    reconnectTimeoutRef.current = window.setTimeout(() => {
      // Will trigger reconnect via connect()
      setIsConnecting(true);
    }, delay);
  }, []);

  // Centrifugo Connection (Web Worker for browser, Tauri API for desktop)
  const connect = useCallback(async () => {
    setIsConnecting(true);
    setConnectionError(null);

    try {
      const token = await fetchCentrifugoToken();
      const centrifugoUrl = getCentrifugoUrl();
      const channelName = urlChannel || 'default';

      if (isTauri()) {
        // Tauri: Use Rust backend for Centrifugo connection
        const { connectCentrifugo, subscribeChannel, listenCentrifugoEvents } = await import('../lib/tauri-centrifugo');

        // Listen for events
        await listenCentrifugoEvents((event) => {
          switch (event.type) {
            case 'connected':
              setIsConnected(true);
              setIsConnecting(false);
              setConnectionError(null);
              reconnectAttempts.current = 0;
              break;

            case 'disconnected':
              setIsConnected(false);
              setIsConnecting(false);
              scheduleReconnect();
              break;

            case 'error':
              setConnectionError(event.error || 'Connection error');
              break;

            case 'publication':
              if (event.data) {
                handlePublication(event.data);
              }
              break;
          }
        });

        await connectCentrifugo(centrifugoUrl, token);

        // Subscribe to channel
        await subscribeChannel('main', channelName);

      } else {
        // Browser: Use Web Worker for Centrifugo connection
        const worker = new Worker(
          new URL('../lib/centrifugo-worker.ts', import.meta.url),
          { type: 'module' }
        );
        workerRef.current = worker;

        worker.onmessage = (event) => {
          const message = event.data;

          switch (message.type) {
            case 'connected':
              setIsConnected(true);
              setIsConnecting(false);
              setConnectionError(null);
              reconnectAttempts.current = 0;

              // Subscribe to channel after connected
              worker.postMessage({
                type: 'subscribe',
                channelId: 'main',
                channelName,
              });
              break;

            case 'disconnected':
              setIsConnected(false);
              setIsConnecting(false);
              setConnectionError(`Disconnected: ${message.reason}`);
              scheduleReconnect();
              break;

            case 'error':
              setConnectionError(message.error);
              break;

            case 'publication':
              handlePublication(message.data);
              break;

            case 'token-needed':
              // Refresh token when needed
              fetchCentrifugoToken()
                .then((newToken) => {
                  worker.postMessage({ type: 'refresh-token', token: newToken });
                })
                .catch((err) => {
                  console.error('Failed to refresh token:', err);
                });
              break;
          }
        };

        worker.postMessage({
          type: 'connect',
          url: centrifugoUrl,
          token,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      setConnectionError(message);
      setIsConnecting(false);
      scheduleReconnect();
    }
  }, [urlChannel, handlePublication, scheduleReconnect]);

  // Start connection on mount
  useEffect(() => {
    connect();

    return () => {
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'disconnect' });
        workerRef.current.terminate();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
      }
    };
  }, [connect]);

  // Clear logs function
  const clearLogs = useCallback(async () => {
    await clearAllLogs();
    setTotalCount(0);
    setHasEncryptedLogs(false);
    notifyClear();
    fetch('/api/logs', { method: 'DELETE' }).catch(console.error);
  }, [notifyClear]);

  return {
    totalCount,
    isInitialized,
    clearLogs,
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
  };
}
