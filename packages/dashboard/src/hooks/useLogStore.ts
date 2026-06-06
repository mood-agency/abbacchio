import { useState, useEffect, useRef, useCallback } from 'react';
import type { LogEntry } from '../types';
import {
  initDatabase,
  insertLogs,
  clearAllLogs,
  getLogCount,
  requestPersistence,
} from '../lib/sqlite-db';


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

  /** Channels */
  channels: string[];
  urlChannel: string;
  /** Persistence toggle */
  persistLogs: boolean;
  setPersistLogs: (persist: boolean) => void;
  /** Queue logs for batched processing */
  queueLogs: (logs: LogEntry[]) => void;
}

const initialUrlParams = (() => {
  const params = new URLSearchParams(window.location.search);
  const channel = params.get('channel') || '';

  return { channel };
})();

export function useLogStore(): UseLogStoreResult {
  const [totalCount, setTotalCount] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [channels] = useState<string[]>(['default']);
  const [urlChannel] = useState(initialUrlParams.channel);
  const [persistLogs, setPersistLogs] = useState(true);
  const newLogsCallbacks = useRef<Set<(logs: LogEntry[]) => void>>(new Set());
  const clearCallbacks = useRef<Set<() => void>>(new Set());

  // Batching: accumulate logs and flush periodically
  const pendingLogsRef = useRef<LogEntry[]>([]);
  const flushTimeoutRef = useRef<number | null>(null);
  const isFlushing = useRef(false);
  const persistLogsRef = useRef(persistLogs);
  const BATCH_INTERVAL_MS = 100; // Flush every 100ms


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


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
      }
    };
  }, []);

  // Clear logs function
  const clearLogs = useCallback(async () => {
    await clearAllLogs();
    setTotalCount(0);
    notifyClear();
    fetch('/api/logs', { method: 'DELETE' }).catch(console.error);
  }, [notifyClear]);

  return {
    totalCount,
    isInitialized,
    clearLogs,
    onNewLogs,
    onClear,

    channels,
    urlChannel,
    persistLogs,
    setPersistLogs,
    queueLogs,
  };
}
