import { useState, useEffect, useRef, useCallback } from 'react';
import type { LogEntry, LogLevelLabel } from '../types';
import { decryptLog, isCryptoAvailable } from '../lib/crypto';

const MAX_LOGS = 1000;
const LOG_LEVELS: Record<number, LogLevelLabel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

interface UseLogStreamResult {
  logs: LogEntry[];
  isConnected: boolean;
  isConnecting: boolean;
  clearLogs: () => void;
  connectionError: string | null;
  secretKey: string;
  setSecretKey: (key: string) => void;
  hasEncryptedLogs: boolean;
  /** Available channels */
  channels: string[];
  /** Channel filter from URL parameter */
  urlChannel: string;
}

// Get URL parameters
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    channel: params.get('channel') || '',
    key: params.get('key') || '',
  };
}

export function useLogStream(): UseLogStreamResult {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState(() => {
    // URL param takes priority, then localStorage
    const urlParams = getUrlParams();
    if (urlParams.key) return urlParams.key;
    return localStorage.getItem('pino-live-secret-key') || '';
  });
  const [channels, setChannels] = useState<string[]>(['default']);
  const [urlChannel] = useState(() => getUrlParams().channel);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number>();
  const reconnectAttempts = useRef(0);
  const secretKeyRef = useRef(secretKey);

  // Keep ref in sync
  useEffect(() => {
    secretKeyRef.current = secretKey;
    // Save to localStorage
    if (secretKey) {
      localStorage.setItem('pino-live-secret-key', secretKey);
    } else {
      localStorage.removeItem('pino-live-secret-key');
    }
  }, [secretKey]);

  // Decrypt a log entry if encrypted
  const processEntry = useCallback(async (entry: LogEntry): Promise<LogEntry> => {
    if (!entry.encrypted || !entry.encryptedData) {
      return entry;
    }

    const key = secretKeyRef.current;
    if (!key || !isCryptoAvailable()) {
      return { ...entry, decryptionFailed: !key };
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
        return { ...entry, decryptionFailed: true };
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
      };
    } catch {
      return { ...entry, decryptionFailed: true };
    }
  }, []);

  // Re-decrypt all encrypted logs when secret key changes
  useEffect(() => {
    if (!secretKey) return;

    const decryptExisting = async () => {
      const updated = await Promise.all(
        logs.map(async (log) => {
          if (log.encrypted && log.encryptedData && !log.decryptionFailed) {
            return processEntry(log);
          }
          // Retry failed decryptions with new key
          if (log.decryptionFailed && log.encryptedData) {
            return processEntry({ ...log, encrypted: true, decryptionFailed: false });
          }
          return log;
        })
      );
      setLogs(updated);
    };

    decryptExisting();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretKey]);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setIsConnecting(true);
    setConnectionError(null);

    // Build stream URL with optional channel filter
    const streamUrl = urlChannel
      ? `/api/logs/stream?channel=${encodeURIComponent(urlChannel)}`
      : '/api/logs/stream';
    const eventSource = new EventSource(streamUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setIsConnecting(false);
      setConnectionError(null);
      reconnectAttempts.current = 0;
    };

    eventSource.addEventListener('log', async (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        const processed = await processEntry(entry);
        setLogs((prev) => {
          const next = [processed, ...prev];
          return next.slice(0, MAX_LOGS);
        });
      } catch (e) {
        console.error('Failed to parse log event:', e);
      }
    });

    eventSource.addEventListener('batch', async (event) => {
      try {
        const entries: LogEntry[] = JSON.parse(event.data);
        const processed = await Promise.all(entries.map(processEntry));
        setLogs((prev) => {
          const next = [...processed.reverse(), ...prev];
          return next.slice(0, MAX_LOGS);
        });
      } catch (e) {
        console.error('Failed to parse batch event:', e);
      }
    });

    eventSource.addEventListener('channels', (event) => {
      try {
        const channelList: string[] = JSON.parse(event.data);
        setChannels(channelList);
      } catch (e) {
        console.error('Failed to parse channels event:', e);
      }
    });

    eventSource.addEventListener('channel:added', (event) => {
      const newChannel = event.data;
      setChannels((prev) => {
        if (prev.includes(newChannel)) return prev;
        return [...prev, newChannel];
      });
    });

    eventSource.onerror = () => {
      setIsConnected(false);
      setIsConnecting(false);
      eventSource.close();

      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current++;
      setConnectionError(`Connection lost. Reconnecting in ${delay / 1000}s...`);

      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };
  }, [processEntry, urlChannel]);

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

  const clearLogs = useCallback(() => {
    setLogs([]);
    fetch('/api/logs', { method: 'DELETE' }).catch(console.error);
  }, []);

  const hasEncryptedLogs = logs.some((log) => log.encrypted || log.decryptionFailed);

  return {
    logs,
    isConnected,
    isConnecting,
    clearLogs,
    connectionError,
    secretKey,
    setSecretKey,
    hasEncryptedLogs,
    channels,
    urlChannel,
  };
}
