import type { LogEntry } from '../types';

/**
 * Max logs held in memory for the active channel. Beyond this the oldest are
 * dropped; they stay on the server and come back via "load older" pagination.
 */
export const MAX_LOGS_IN_MEMORY = 50_000;

/**
 * Duplicates only come from overlapping recent deliveries (initial load vs SSE
 * vs reconnect backfill), so checking the newest entries is enough — and keeps
 * each SSE event O(window) instead of O(all logs held).
 */
const DEDUP_WINDOW = 5_000;

export interface AppendResult {
  logs: LogEntry[];
  /** Number of new (non-duplicate) logs appended */
  added: number;
  /** True when the oldest logs were dropped to stay within the cap */
  trimmed: boolean;
}

/** Append newer logs, skipping ids already present near the tail, and enforce the cap. */
export function appendLogs(prev: LogEntry[], incoming: LogEntry[], max = MAX_LOGS_IN_MEMORY): AppendResult {
  const recentIds = new Set<string>();
  for (let i = Math.max(0, prev.length - DEDUP_WINDOW); i < prev.length; i++) {
    recentIds.add(prev[i].id);
  }
  const unique: LogEntry[] = [];
  for (const log of incoming) {
    if (recentIds.has(log.id)) continue;
    recentIds.add(log.id); // also dedupes within the incoming batch
    unique.push(log);
  }
  if (unique.length === 0) return { logs: prev, added: 0, trimmed: false };

  const combined = prev.concat(unique);
  if (combined.length <= max) return { logs: combined, added: unique.length, trimmed: false };
  return { logs: combined.slice(combined.length - max), added: unique.length, trimmed: true };
}

