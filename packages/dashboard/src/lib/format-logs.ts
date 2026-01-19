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

export type ExportFormat = 'json' | 'csv' | 'sql';

/**
 * Escape a value for CSV (handles quotes and commas)
 */
function escapeCsvValue(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Escape a value for SQL string
 */
function escapeSqlValue(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Format logs as CSV for export
 */
export function formatLogsAsCsv(logs: LogEntry[]): string {
  const headers = ['timestamp', 'level', 'namespace', 'channel', 'message', 'data'];
  const rows = logs.map(log => [
    new Date(log.time).toISOString(),
    log.levelLabel,
    log.namespace || '',
    log.channel,
    log.msg,
    Object.keys(log.data).length > 0 ? JSON.stringify(log.data) : '',
  ].map(escapeCsvValue).join(','));

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Format logs as SQL INSERT statements for export
 */
export function formatLogsAsSql(logs: LogEntry[], tableName: string = 'logs'): string {
  if (logs.length === 0) return '';

  const statements = logs.map(log => {
    const timestamp = new Date(log.time).toISOString();
    const level = escapeSqlValue(log.levelLabel);
    const namespace = log.namespace ? `'${escapeSqlValue(log.namespace)}'` : 'NULL';
    const channel = escapeSqlValue(log.channel);
    const msg = escapeSqlValue(log.msg);
    const data = Object.keys(log.data).length > 0
      ? `'${escapeSqlValue(JSON.stringify(log.data))}'`
      : 'NULL';

    return `INSERT INTO ${tableName} (timestamp, level, namespace, channel, message, data) VALUES ('${timestamp}', '${level}', ${namespace}, '${channel}', '${msg}', ${data});`;
  });

  const createTable = `-- Table creation (optional)
CREATE TABLE IF NOT EXISTS ${tableName} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TIMESTAMP NOT NULL,
  level VARCHAR(10) NOT NULL,
  namespace VARCHAR(255),
  channel VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSON
);

-- Insert statements
`;

  return createTable + statements.join('\n');
}

/**
 * Export logs to a downloadable file
 */
export function downloadLogs(logs: LogEntry[], format: ExportFormat, channelName: string): void {
  let content: string;
  let mimeType: string;
  let extension: string;

  switch (format) {
    case 'json':
      content = formatLogsAsJson(logs);
      mimeType = 'application/json';
      extension = 'json';
      break;
    case 'csv':
      content = formatLogsAsCsv(logs);
      mimeType = 'text/csv';
      extension = 'csv';
      break;
    case 'sql':
      content = formatLogsAsSql(logs, `logs_${channelName.replace(/[^a-zA-Z0-9_]/g, '_')}`);
      mimeType = 'text/sql';
      extension = 'sql';
      break;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${channelName}_${timestamp}.${extension}`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
