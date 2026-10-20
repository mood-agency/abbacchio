import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, ConnectionStatus } from '../types/index.js';

interface UsePollingOptions {
  apiUrl: string;
  channel: string;
  onLog?: (log: LogEntry) => void;
  onBatch?: (logs: LogEntry[]) => void;
}

interface UsePollingResult {
  status: ConnectionStatus;
  error: string | null;
  reconnect: () => void;
}

const POLL_INTERVAL = 1000;

export function usePolling(options: UsePollingOptions): UsePollingResult {
  const { apiUrl, channel, onLog, onBatch } = options;

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const lastIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // One request at a time: a slow response must not race the next tick and
  // rewind lastIdRef. The generation discards responses from before a reconnect.
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);

  // Store callbacks in refs to avoid reconnection on callback changes
  const onLogRef = useRef(onLog);
  const onBatchRef = useRef(onBatch);

  useEffect(() => {
    onLogRef.current = onLog;
    onBatchRef.current = onBatch;
  }, [onLog, onBatch]);

  const poll = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const generation = generationRef.current;
    try {
      const params = new URLSearchParams({ channel });
      if (lastIdRef.current) {
        params.set('afterId', lastIdRef.current);
      }

      const res = await fetch(`${apiUrl}/api/logs?${params}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      if (!mountedRef.current || generation !== generationRef.current) return;

      setStatus('connected');
      setError(null);

      const data = await res.json() as { logs: LogEntry[] };
      if (generation !== generationRef.current) return;
      const logs: LogEntry[] = data.logs || [];

      if (logs.length > 0) {
        lastIdRef.current = logs[logs.length - 1].id;

        if (logs.length === 1) {
          onLogRef.current?.(logs[0]);
        } else {
          onBatchRef.current?.(logs);
        }
      }
    } catch (err) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      if (generation === generationRef.current) inFlightRef.current = false;
    }
  }, [apiUrl, channel]);

  const connect = useCallback(() => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    lastIdRef.current = null;
    generationRef.current++;
    inFlightRef.current = false;
    setStatus('connecting');
    setError(null);

    // Initial fetch
    poll();

    // Set up polling interval
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
  }, [poll]);

  const reconnect = useCallback(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connect]);

  return { status, error, reconnect };
}
