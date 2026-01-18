import { useState, useEffect, useCallback, useRef } from 'react';
import { EventSource } from 'eventsource';
import type { LogEntry, ConnectionStatus } from '../types/index.js';

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_TIMEOUT = 45000; // Reconnect if no ping received in 45s

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
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY);

  // Reset heartbeat timer - called on any server activity
  const resetHeartbeat = useCallback((onTimeout: () => void) => {
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }
    heartbeatTimeoutRef.current = setTimeout(() => {
      // Connection seems stale, trigger reconnect
      onTimeout();
    }, HEARTBEAT_TIMEOUT);
  }, []);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }

    setStatus('connecting');
    setError(null);

    const url = `${apiUrl}/api/logs/stream?channel=${encodeURIComponent(channel)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    // Heartbeat timeout handler
    const handleHeartbeatTimeout = () => {
      setError('Connection stale, reconnecting...');
      es.close();
      reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
    };

    es.onopen = () => {
      setStatus('connected');
      setError(null);
      reconnectDelayRef.current = RECONNECT_DELAY;
      resetHeartbeat(handleHeartbeatTimeout);
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
      resetHeartbeat(handleHeartbeatTimeout);
      try {
        const log: LogEntry = JSON.parse(e.data);
        onLog?.(log);
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('batch', (e: MessageEvent) => {
      resetHeartbeat(handleHeartbeatTimeout);
      try {
        const logs: LogEntry[] = JSON.parse(e.data);
        onBatch?.(logs);
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('channels', (e: MessageEvent) => {
      resetHeartbeat(handleHeartbeatTimeout);
      try {
        const channels: string[] = JSON.parse(e.data);
        onChannels?.(channels);
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('ping', () => {
      // Keep-alive - reset heartbeat timer
      resetHeartbeat(handleHeartbeatTimeout);
    });
  }, [apiUrl, channel, onLog, onBatch, onChannels, resetHeartbeat]);

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
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
      }
    };
  }, [connect]);

  return { status, error, reconnect };
}
