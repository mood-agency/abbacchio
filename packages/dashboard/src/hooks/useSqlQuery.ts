import { useState, useCallback, useRef } from 'react';

export interface SqlQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

export interface SqlHistoryEntry {
  sql: string;
  timestamp: number;
  success: boolean;
  rowCount?: number;
  executionTimeMs?: number;
  error?: string;
}

const MAX_HISTORY = 50;
const API_BASE = '/api';

export function useSqlQuery() {
  const [sql, setSql] = useState('SELECT * FROM logs LIMIT 100');
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);

  const execute = useCallback(async (query?: string) => {
    const sqlToRun = query ?? sql;
    if (!sqlToRun.trim()) return;

    setIsExecuting(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlToRun.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const res: SqlQueryResult = data;
      setResult(res);
      setHistory(prev => {
        const entry: SqlHistoryEntry = {
          sql: sqlToRun.trim(),
          timestamp: Date.now(),
          success: true,
          rowCount: res.rowCount,
          executionTimeMs: res.executionTimeMs,
        };
        return [entry, ...prev].slice(0, MAX_HISTORY);
      });
      historyIndexRef.current = -1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setResult(null);
      setHistory(prev => {
        const entry: SqlHistoryEntry = {
          sql: sqlToRun.trim(),
          timestamp: Date.now(),
          success: false,
          error: message,
        };
        return [entry, ...prev].slice(0, MAX_HISTORY);
      });
      historyIndexRef.current = -1;
    } finally {
      setIsExecuting(false);
    }
  }, [sql]);

  const navigateHistory = useCallback((direction: 'up' | 'down') => {
    if (history.length === 0) return;

    let newIndex = historyIndexRef.current;
    if (direction === 'up') {
      newIndex = Math.min(newIndex + 1, history.length - 1);
    } else {
      newIndex = Math.max(newIndex - 1, -1);
    }

    historyIndexRef.current = newIndex;
    if (newIndex >= 0) {
      setSql(history[newIndex].sql);
    }
  }, [history]);

  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    sql,
    setSql,
    result,
    error,
    isExecuting,
    history,
    execute,
    navigateHistory,
    clearResult,
  };
}
