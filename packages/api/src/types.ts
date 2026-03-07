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
 * Incoming log entry from HTTP POST (plain)
 */
export interface IncomingLog {
  level?: number;
  time?: number;
  msg?: string;
  message?: string; // Alternative to msg (Winston style)
  namespace?: string;
  name?: string; // Alternative to namespace (child logger)
  channel?: string; // Optional per-log channel override
  traceId?: string; // OTLP correlation
  spanId?: string; // OTLP correlation
  [key: string]: unknown;
}

/**
 * Encrypted log entry
 */
export interface EncryptedLog {
  encrypted: string;
}

/**
 * Incoming log can be plain or encrypted
 */
export type IncomingLogOrEncrypted = IncomingLog | EncryptedLog;

/**
 * Normalized log entry stored in buffer
 */
export interface LogEntry {
  id: string;
  level: number;
  levelLabel: LogLevelLabel;
  time: number;
  msg: string;
  namespace?: string;
  /** Channel/app identifier for multi-app support */
  channel: string;
  data: Record<string, unknown>;
  /** OTLP correlation fields */
  traceId?: string;
  spanId?: string;
  /** If true, the log is encrypted and needs client-side decryption */
  encrypted?: boolean;
  /** The encrypted payload (only present if encrypted=true) */
  encryptedData?: string;
}

/**
 * Batch log request body
 */
export interface BatchLogRequest {
  logs: IncomingLog[];
}

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number;
  bufferSize: number;
  apiKey?: string;
  corsOrigin: string;
}

/**
 * Internal Trace Span representation
 */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** Start time in Unix Epoch milliseconds (converted from nanos at ingestion) */
  startTimeMs: number;
  /** End time in Unix Epoch milliseconds (converted from nanos at ingestion) */
  endTimeMs: number;
  /** Channel/app identifier */
  channel: string;
  attributes: Record<string, string | number | boolean>;
  status?: {
    code: number; // 0 = UNSET, 1 = OK, 2 = ERROR
    message?: string;
  };
}

/**
 * Internal Metric representation (Counter or Gauge)
 */
export interface MetricDataPoint {
  name: string;
  description?: string;
  unit?: string;
  type: 'Sum' | 'Gauge' | 'Histogram';
  /** Channel/app identifier */
  channel: string;
  /** Time of recording in Unix Epoch microseconds */
  timeUnixNano: number;
  value: number;
  count?: number;
  bucketCounts?: number[];
  explicitBounds?: number[];
  attributes: Record<string, string | number | boolean>;
}

/**
 * API event types
 */
export type APIEventType = 'log' | 'batch' | 'ping' | 'channels' | 'channel:added' | 'metric' | 'trace';

/**
 * Server statistics response
 */
export interface ServerStats {
  connections: {
    totalConnections: number;
    connectionsByChannel: Record<string, number>;
    oldestConnection: number | null;
    totalBytesSent: number;
    totalMessagesSent: number;
    totalMessagesDropped: number;
  };
  channels: {
    channelCount: number;
    maxChannels: number;
    channels: Array<{
      name: string;
      createdAt: number;
      lastActivity: number;
      logCount: number;
    }>;
  };
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'ok';
  uptime: number;
  connections: number;
  maxConnections: number;
  channels: number;
}
