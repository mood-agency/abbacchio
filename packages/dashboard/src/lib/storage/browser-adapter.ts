/**
 * Browser storage adapter - wraps existing Web Worker + OPFS implementation
 */
import type { LogEntry } from '../../types';
import type {
  LogDatabase,
  QueryOptions,
  CountFilterOptions,
  LevelCounts,
  NamespaceCounts,
  DatabaseStats,
  SearchMatchCountOptions,
  PruneOptions,
  TimeWindowQueryOptions,
  TimeWindowResult,
  HourlyLogCount,
  LogTimeRange,
  GetHourlyLogCountsOptions,
  GetLogIndexByTimeOptions,
} from './types';
import SqliteWorker from '../sqlite-worker?worker';

type SQLiteRow = Record<string, string | number | null>;

/**
 * Convert a SQLite row into a LogEntry with properly typed fields.
 *
 * @returns A LogEntry with properties mapped from the input row; `data` is parsed from JSON, and numeric flag fields (`encrypted`, `decryptionFailed`, `wasEncrypted`) are converted to booleans.
 */
function rowToLogEntry(row: SQLiteRow): LogEntry {
  return {
    id: row.id as string,
    level: row.level as number,
    levelLabel: row.level_label as LogEntry['levelLabel'],
    time: row.time as number,
    msg: row.msg as string,
    namespace: row.namespace as string | undefined,
    channel: row.channel as string,
    data: JSON.parse(row.data as string) as Record<string, unknown>,
    encrypted: row.encrypted === 1,
    encryptedData: row.encrypted_data as string | undefined,
    decryptionFailed: row.decryption_failed === 1,
    wasEncrypted: row.was_encrypted === 1,
  };
}

/**
 * Browser-based LogDatabase implementation using Web Worker + OPFS
 */
export class BrowserLogDatabase implements LogDatabase {
  private worker: Worker | null = null;
  private messageId = 0;
  private pendingMessages = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private initPromise: Promise<void> | null = null;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new SqliteWorker();
      this.worker.onmessage = (e) => {
        const { id, success, result, error } = e.data;
        const pending = this.pendingMessages.get(id);
        if (pending) {
          this.pendingMessages.delete(id);
          if (success) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error));
          }
        }
      };
    }
    return this.worker;
  }

  private sendMessage<T = void>(action: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingMessages.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.getWorker().postMessage({ id, action, payload });
    });
  }

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.sendMessage('init');
    return this.initPromise;
  }

  async requestPersistence(): Promise<boolean> {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist();
    }
    return false;
  }

  async insertLogs(logs: LogEntry[]): Promise<void> {
    if (logs.length === 0) return;
    await this.init();
    await this.sendMessage('insertLogs', logs);
  }

  async updateLog(log: LogEntry): Promise<void> {
    return this.insertLogs([log]);
  }

  async updateLogs(logs: LogEntry[]): Promise<void> {
    return this.insertLogs(logs);
  }

  async clearAllLogs(): Promise<void> {
    await this.init();
    await this.sendMessage('clearAllLogs');
  }

  async clearLogsForChannel(channel: string): Promise<void> {
    await this.init();
    await this.sendMessage('clearLogsForChannel', { channel });
  }

  async queryLogs(options: QueryOptions = {}): Promise<LogEntry[]> {
    await this.init();
    const rows = await this.sendMessage<SQLiteRow[]>('queryLogs', options);
    return rows.map(rowToLogEntry);
  }

  async queryLogsInTimeWindow(
    options: TimeWindowQueryOptions
  ): Promise<TimeWindowResult> {
    await this.init();
    const rows = await this.sendMessage<SQLiteRow[]>(
      'queryLogsInTimeWindow',
      options
    );
    const logs = rows.map(rowToLogEntry);
    return {
      logs,
      windowStart: options.centerTime - options.windowHalfSize,
      windowEnd: options.centerTime + options.windowHalfSize,
    };
  }

  async getFilteredCount(options: QueryOptions = {}): Promise<number> {
    await this.init();
    return this.sendMessage<number>('getFilteredCount', options);
  }

  async getLogCount(): Promise<number> {
    await this.init();
    return this.sendMessage<number>('getLogCount');
  }

  async getDistinctNamespaces(channel?: string): Promise<string[]> {
    await this.init();
    return this.sendMessage<string[]>('getDistinctNamespaces', { channel });
  }

  async getNamespaceCounts(
    options?: CountFilterOptions | string
  ): Promise<NamespaceCounts> {
    await this.init();
    const payload = typeof options === 'string' ? { channel: options } : options;
    return this.sendMessage<NamespaceCounts>('getNamespaceCounts', payload);
  }

  async getLevelCounts(
    options?: CountFilterOptions | string
  ): Promise<LevelCounts> {
    await this.init();
    const payload = typeof options === 'string' ? { channel: options } : options;
    return this.sendMessage<LevelCounts>('getLevelCounts', payload);
  }

  async getDatabaseStats(): Promise<DatabaseStats> {
    await this.init();
    return this.sendMessage<DatabaseStats>('getDatabaseStats');
  }

  async hasEncryptedLogs(channel?: string): Promise<boolean> {
    await this.init();
    return this.sendMessage<boolean>('hasEncryptedLogs', { channel });
  }

  async getLogsNeedingDecryption(channel?: string): Promise<LogEntry[]> {
    await this.init();
    const rows = await this.sendMessage<SQLiteRow[]>('getLogsNeedingDecryption', {
      channel,
    });
    return rows.map(rowToLogEntry);
  }

  async getHourlyLogCounts(
    options: GetHourlyLogCountsOptions
  ): Promise<HourlyLogCount[]> {
    await this.init();
    return this.sendMessage<HourlyLogCount[]>('getHourlyLogCounts', options);
  }

  async getLogTimeRange(channel: string): Promise<LogTimeRange> {
    await this.init();
    return this.sendMessage<LogTimeRange>('getLogTimeRange', { channel });
  }

  async getLogIndexByTime(options: GetLogIndexByTimeOptions): Promise<number> {
    await this.init();
    return this.sendMessage<number>('getLogIndexByTime', options);
  }

  async getSearchMatchCount(options: SearchMatchCountOptions): Promise<number> {
    await this.init();
    return this.sendMessage<number>('getSearchMatchCount', options);
  }

  async pruneOldLogs(options?: PruneOptions): Promise<void> {
    await this.init();
    await this.sendMessage('pruneOldLogs', options);
  }
}