import type { LogEntry } from '../types';

/**
 * Format a single log entry for clipboard
 */
function formatLogEntry(log: LogEntry): string {
  const date = new Date(log.time);
  const timestamp = date.toISOString();
  const level = log.levelLabel.toUpperCase().padEnd(5);
  const namespace = log.namespace ? `[${log.namespace}]` : '';
  const data = Object.keys(log.data).length > 0 ? ` ${JSON.stringify(log.data)}` : '';

  return `${timestamp} ${level} ${namespace} ${log.msg}${data}`.trim();
}

/**
 * Format multiple log entries for clipboard copy
 * Returns a clean, ordered text representation
 */
export function formatLogsForClipboard(logs: LogEntry[]): string {
  return logs.map(formatLogEntry).join('\n');
}

/**
 * Format logs as JSON for clipboard
 */
export function formatLogsAsJson(logs: LogEntry[]): string {
  const cleanLogs = logs.map(log => ({
    time: new Date(log.time).toISOString(),
    level: log.levelLabel,
    namespace: log.namespace || undefined,
    msg: log.msg,
    data: Object.keys(log.data).length > 0 ? log.data : undefined,
    channel: log.channel,
  }));
  return JSON.stringify(cleanLogs, null, 2);
}
