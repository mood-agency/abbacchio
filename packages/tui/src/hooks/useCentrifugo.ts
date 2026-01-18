import { useState, useEffect, useCallback, useRef } from 'react';
import { Centrifuge, Subscription } from 'centrifuge';
import WebSocket from 'ws';
import type { LogEntry, ConnectionStatus } from '../types/index.js';

// Polyfill WebSocket for Node.js
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

interface UseCentrifugoOptions {
  apiUrl: string;
  channel: string;
  onLog?: (log: LogEntry) => void;
  onBatch?: (logs: LogEntry[]) => void;
}

interface UseCentrifugoResult {
  status: ConnectionStatus;
  error: string | null;
  reconnect: () => void;
}

interface CentrifugoMessage {
  type: 'log' | 'batch';
  data: LogEntry | LogEntry[];
}

/**
 * Get the Centrifugo WebSocket URL based on API URL
 */
function getCentrifugoUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // In development, Centrifugo runs on port 8000
  const isDev = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const port = isDev ? '8000' : url.port;
  return `${protocol}//${url.hostname}:${port}/connection/websocket`;
}

/**
 * Fetch a connection token from the API
 */
async function fetchCentrifugoToken(apiUrl: string): Promise<string> {
  const response = await fetch(`${apiUrl}/api/centrifugo/token`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Centrifugo token: ${response.status}`);
  }
  const data = await response.json() as { token: string };
  return data.token;
}

export function useCentrifugo(options: UseCentrifugoOptions): UseCentrifugoResult {
  const { apiUrl, channel, onLog, onBatch } = options;

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  const centrifugeRef = useRef<Centrifuge | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);
  const mountedRef = useRef(true);

  // Store callbacks in refs to avoid reconnection on callback changes
  const onLogRef = useRef(onLog);
  const onBatchRef = useRef(onBatch);

  useEffect(() => {
    onLogRef.current = onLog;
    onBatchRef.current = onBatch;
  }, [onLog, onBatch]);

  const connect = useCallback(async () => {
    // Clean up existing connection
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }
    if (centrifugeRef.current) {
      centrifugeRef.current.disconnect();
      centrifugeRef.current = null;
    }

    setStatus('connecting');
    setError(null);

    try {
      // Fetch token from API
      const token = await fetchCentrifugoToken(apiUrl);
      if (!mountedRef.current) return;

      // Create Centrifugo client
      const wsUrl = getCentrifugoUrl(apiUrl);
      const centrifuge = new Centrifuge(wsUrl, {
        token,
        getToken: async () => {
          // Refresh token when needed
          return fetchCentrifugoToken(apiUrl);
        },
      });

      centrifugeRef.current = centrifuge;

      // Connection events
      centrifuge.on('connected', () => {
        if (!mountedRef.current) return;
        setStatus('connected');
        setError(null);
      });

      centrifuge.on('disconnected', (ctx) => {
        if (!mountedRef.current) return;
        setStatus('error');
        setError(ctx.reason || 'Disconnected');
      });

      centrifuge.on('error', (ctx) => {
        if (!mountedRef.current) return;
        setError(ctx.error?.message || 'Connection error');
      });

      // Subscribe to channel
      const centrifugoChannel = `logs:${channel}`;
      const sub = centrifuge.newSubscription(centrifugoChannel);

      sub.on('subscribed', () => {
        if (!mountedRef.current) return;
        setStatus('connected');
      });

      sub.on('publication', (ctx) => {
        if (!mountedRef.current) return;
        try {
          const message = ctx.data as CentrifugoMessage;
          if (message.type === 'log') {
            onLogRef.current?.(message.data as LogEntry);
          } else if (message.type === 'batch') {
            onBatchRef.current?.(message.data as LogEntry[]);
          }
        } catch {
          // Ignore parse errors
        }
      });

      sub.on('error', (ctx) => {
        if (!mountedRef.current) return;
        setError(ctx.error?.message || 'Subscription error');
      });

      subscriptionRef.current = sub;
      sub.subscribe();
      centrifuge.connect();

    } catch (err) {
      if (!mountedRef.current) return;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to connect');

      // Retry after delay
      setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, 3000);
    }
  }, [apiUrl, channel]);

  const reconnect = useCallback(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
      if (centrifugeRef.current) {
        centrifugeRef.current.disconnect();
        centrifugeRef.current = null;
      }
    };
  }, [connect]);

  return { status, error, reconnect };
}
