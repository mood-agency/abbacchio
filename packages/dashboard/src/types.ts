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
  /** If true, the log is encrypted and needs client-side decryption */
  encrypted?: boolean;
  /** The encrypted payload (only present if encrypted=true) */
  encryptedData?: string;
  /** Set to true after decryption fails */
  decryptionFailed?: boolean;
  /** True if the message was originally sent encrypted (persists after decryption) */
  wasEncrypted?: boolean;
}

export type FilterLevel = 'all' | LogLevelLabel;

/** Array of selected log levels for multi-select filtering */
export type FilterLevels = LogLevelLabel[];

/** Array of selected namespaces for multi-select filtering */
export type FilterNamespaces = string[];

/** Time range options for filtering logs */
export const TIME_RANGE_OPTIONS = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '2w': 14 * 24 * 60 * 60 * 1000,
  'all': 0,
} as const;

export type TimeRange = keyof typeof TIME_RANGE_OPTIONS;
