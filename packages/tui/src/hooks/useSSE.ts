import { useState, useEffect, useCallback, useRef } from 'react';
import { EventSource } from 'eventsource';
import type { LogEntry, ConnectionStatus } from '../types/index.js';

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;

interface UseSSEOptions {
  apiUrl: string;
  channel: string;
  onLog?: (log: LogEntry) => void;
  onBatch?: (logs: LogEntry[]) => void;
  onChannels?: (channels: string[]) => void;
}

interface UseSSEResult {
  status: ConnectionStatus;
  error: string | null;
  reconnect: () => void;
}

export function useSSE(options: UseSSEOptions): UseSSEResult {
  const { apiUrl, channel, onLog, onBatch, onChannels } = options;

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    setStatus('connecting');
    setError(null);

    const url = `${apiUrl}/api/logs/stream?channel=${encodeURIComponent(channel)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus('connected');
      setError(null);
      reconnectDelayRef.current = RECONNECT_DELAY;
    };

    es.onerror = (e: Event) => {
      const errorEvent = e as unknown as { message?: string };
      setStatus('error');
      setError(errorEvent.message || 'Connection error');

      es.close();

      // Schedule reconnection with exponential backoff
      reconnectTimeoutRef.current = setTimeout(() => {
        setStatus('connecting');
        connect();
      }, reconnectDelayRef.current);

      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * 2,
        MAX_RECONNECT_DELAY
      );
    };

    es.addEventListener('log', (e: MessageEvent) => {
      try {
        const log: LogEntry = JSON.parse(e.data);
        onLog?.(log);
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('batch', (e: MessageEvent) => {
      try {
        const logs: LogEntry[] = JSON.parse(e.data);
        onBatch?.(logs);
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('channels', (e: MessageEvent) => {
      try {
        const channels: string[] = JSON.parse(e.data);
        onChannels?.(channels);
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('ping', () => {
      // Keep-alive, no action needed
    });
  }, [apiUrl, channel, onLog, onBatch, onChannels]);

  const reconnect = useCallback(() => {
    reconnectDelayRef.current = RECONNECT_DELAY;
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return { status, error, reconnect };
}
