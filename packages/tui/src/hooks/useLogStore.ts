import { useState, useCallback, useMemo } from 'react';
import { LOG_LEVELS, type LogEntry, type FilterState, type LogLevelNumber, type LogLevelLabel } from '../types/index.js';
import { tryDecrypt } from '../lib/crypto.js';

const MAX_LOGS = 10000;

interface LogStoreState {
  logs: LogEntry[];
  paused: boolean;
  filter: FilterState;
}

interface LogStoreActions {
  addLog: (log: LogEntry) => void;
  addLogs: (logs: LogEntry[]) => void;
  clear: () => void;
  togglePause: () => void;
  setLevelFilter: (level: LogLevelNumber | null) => void;
  setSearch: (search: string) => void;
  setNamespaceFilter: (namespace?: string) => void;
}

export interface LogStore extends LogStoreState, LogStoreActions {
  filteredLogs: LogEntry[];
}

export function useLogStore(secretKey?: string): LogStore {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<FilterState>({
    level: null,
    search: '',
    namespace: undefined,
  });

  // Known fields that are part of LogEntry structure (not data)
  const KNOWN_FIELDS = new Set(['level', 'time', 'msg', 'message', 'namespace', 'name']);

  // Extract data fields from decrypted log
  const extractDataFields = useCallback((incoming: Record<string, unknown>): Record<string, unknown> => {
    const data: Record<string, unknown> = {};
    for (const key of Object.keys(incoming)) {
      if (!KNOWN_FIELDS.has(key)) {
        data[key] = incoming[key];
      }
    }
    return data;
  }, []);

  // Decrypt log if needed
  const processLog = useCallback((log: LogEntry): LogEntry => {
    if (log.encrypted && log.encryptedData && secretKey) {
      const decrypted = tryDecrypt(log.encryptedData, secretKey);
      if (decrypted) {
        try {
          const parsed = JSON.parse(decrypted) as Record<string, unknown>;
          const level = typeof parsed.level === 'number' ? parsed.level : 30;
          const levelLabel = (LOG_LEVELS[level as LogLevelNumber] || 'info') as LogLevelLabel;

          return {
            id: log.id,
            channel: log.channel,
            level,
            levelLabel,
            time: (parsed.time as number) || log.time,
            msg: (parsed.msg as string) || (parsed.message as string) || '',
            namespace: (parsed.namespace as string) || (parsed.name as string),
            data: extractDataFields(parsed),
            encrypted: false,
          };
        } catch {
          // Keep original log if parsing fails
        }
      }
    }
    return log;
  }, [secretKey, extractDataFields]);

  const addLog = useCallback((log: LogEntry) => {
    if (paused) return;

    const processed = processLog(log);
    setLogs(prev => {
      const newLogs = [...prev, processed];
      if (newLogs.length > MAX_LOGS) {
        return newLogs.slice(-MAX_LOGS);
      }
      return newLogs;
    });
  }, [paused, processLog]);

  const addLogs = useCallback((newLogs: LogEntry[]) => {
    if (paused) return;

    const processed = newLogs.map(processLog);
    setLogs(prev => {
      const combined = [...prev, ...processed];
      if (combined.length > MAX_LOGS) {
        return combined.slice(-MAX_LOGS);
      }
      return combined;
    });
  }, [paused, processLog]);

  const clear = useCallback(() => {
    setLogs([]);
  }, []);

  const togglePause = useCallback(() => {
    setPaused(p => !p);
  }, []);

  const setLevelFilter = useCallback((level: LogLevelNumber | null) => {
    setFilter(f => ({ ...f, level }));
  }, []);

  const setSearch = useCallback((search: string) => {
    setFilter(f => ({ ...f, search }));
  }, []);

  const setNamespaceFilter = useCallback((namespace?: string) => {
    setFilter(f => ({ ...f, namespace }));
  }, []);

  // Filter logs based on current filter state
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Level filter
      if (filter.level !== null && log.level < filter.level) {
        return false;
      }

      // Namespace filter
      if (filter.namespace && log.namespace !== filter.namespace) {
        return false;
      }

      // Search filter
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const msgMatch = log.msg.toLowerCase().includes(searchLower);
        const nsMatch = log.namespace?.toLowerCase().includes(searchLower);
        const dataMatch = JSON.stringify(log.data).toLowerCase().includes(searchLower);
        if (!msgMatch && !nsMatch && !dataMatch) {
          return false;
        }
      }

      return true;
    });
  }, [logs, filter]);

  return {
    logs,
    paused,
    filter,
    filteredLogs,
    addLog,
    addLogs,
    clear,
    togglePause,
    setLevelFilter,
    setSearch,
    setNamespaceFilter,
  };
}
