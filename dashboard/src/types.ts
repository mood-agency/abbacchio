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
}

export type FilterLevel = 'all' | LogLevelLabel;
