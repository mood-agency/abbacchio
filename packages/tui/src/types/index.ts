/**
 * Pino log levels
 */
export const LOG_LEVELS = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
} as const;

export type LogLevelNumber = keyof typeof LOG_LEVELS;
export type LogLevelLabel = (typeof LOG_LEVELS)[LogLevelNumber];

/**
 * Log level name to number mapping
 */
export const LOG_LEVEL_NAMES: Record<LogLevelLabel, LogLevelNumber> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Normalized log entry from SSE
 */
export interface LogEntry {
  id: string;
  level: number;
  levelLabel: LogLevelLabel;
  time: number;
  msg: string;
  namespace?: string;
  channel: string;
  data: Record<string, unknown>;
  encrypted?: boolean;
  encryptedData?: string;
}

/**
 * SSE event types
 */
export type SSEEventType = 'log' | 'batch' | 'ping' | 'channels' | 'channel:added';

/**
 * Connection status
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * CLI options
 */
export interface CLIOptions {
  channel: string;
  apiUrl: string;
  key?: string;
  level?: LogLevelLabel;
}

/**
 * Filter state
 */
export interface FilterState {
  level: LogLevelNumber | null;
  search: string;
  namespace?: string;
}
