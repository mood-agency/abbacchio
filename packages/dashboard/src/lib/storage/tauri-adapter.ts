/**
 * Tauri storage adapter - uses native SQLite via Tauri IPC
 * The SQLite database is stored at a known location accessible by MCP
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

// Tauri invoke function - dynamically imported to avoid errors in browser
type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invoke: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn> {
  if (invoke) return invoke;

  // Dynamic import to avoid bundling Tauri in browser builds
  const tauri = await import('@tauri-apps/api/core');
  invoke = tauri.invoke;
  return invoke;
}

/**
 * Tauri-based LogDatabase implementation using native SQLite file
 * Database is stored at ~/.abbacchio/logs.db (accessible by MCP server)
 */
export class TauriLogDatabase implements LogDatabase {
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const inv = await getInvoke();
      await inv('init_database');
    })();

    return this.initPromise;
  }

  async requestPersistence(): Promise<boolean> {
    // Native SQLite is always persistent
    return true;
  }

  async insertLogs(logs: LogEntry[]): Promise<void> {
    if (logs.length === 0) return;
    await this.init();
    const inv = await getInvoke();
    await inv('insert_logs', { logs });
  }

  async updateLog(log: LogEntry): Promise<void> {
    return this.insertLogs([log]);
  }

  async updateLogs(logs: LogEntry[]): Promise<void> {
    return this.insertLogs(logs);
  }

  async clearAllLogs(): Promise<void> {
    await this.init();
    const inv = await getInvoke();
    await inv('clear_all_logs');
  }

  async clearLogsForChannel(channel: string): Promise<void> {
    await this.init();
    const inv = await getInvoke();
    await inv('clear_logs_for_channel', { channel });
  }

  async queryLogs(options: QueryOptions = {}): Promise<LogEntry[]> {
    await this.init();
    const inv = await getInvoke();
    return inv<LogEntry[]>('query_logs', { options });
  }

  async queryLogsInTimeWindow(
    options: TimeWindowQueryOptions
  ): Promise<TimeWindowResult> {
    await this.init();
    const inv = await getInvoke();
    const logs = await inv<LogEntry[]>('query_logs_in_time_window', { options });
    return {
      logs,
      windowStart: options.centerTime - options.windowHalfSize,
      windowEnd: options.centerTime + options.windowHalfSize,
    };
  }

  async getFilteredCount(options: QueryOptions = {}): Promise<number> {
    await this.init();
    const inv = await getInvoke();
    return inv<number>('get_filtered_count', { options });
  }

  async getLogCount(): Promise<number> {
    await this.init();
    const inv = await getInvoke();
    return inv<number>('get_log_count');
  }

  async getDistinctNamespaces(channel?: string): Promise<string[]> {
    await this.init();
    const inv = await getInvoke();
    return inv<string[]>('get_distinct_namespaces', { channel });
  }

  async getNamespaceCounts(
    options?: CountFilterOptions | string
  ): Promise<NamespaceCounts> {
    await this.init();
    const payload = typeof options === 'string' ? { channel: options } : options;
    const inv = await getInvoke();
    return inv<NamespaceCounts>('get_namespace_counts', { options: payload });
  }

  async getLevelCounts(
    options?: CountFilterOptions | string
  ): Promise<LevelCounts> {
    await this.init();
    const payload = typeof options === 'string' ? { channel: options } : options;
    const inv = await getInvoke();
    return inv<LevelCounts>('get_level_counts', { options: payload });
  }

  async getDatabaseStats(): Promise<DatabaseStats> {
    await this.init();
    const inv = await getInvoke();
    return inv<DatabaseStats>('get_database_stats');
  }

  async hasEncryptedLogs(channel?: string): Promise<boolean> {
    await this.init();
    const inv = await getInvoke();
    return inv<boolean>('has_encrypted_logs', { channel });
  }

  async getLogsNeedingDecryption(channel?: string): Promise<LogEntry[]> {
    await this.init();
    const inv = await getInvoke();
    return inv<LogEntry[]>('get_logs_needing_decryption', { channel });
  }

  async getHourlyLogCounts(
    options: GetHourlyLogCountsOptions
  ): Promise<HourlyLogCount[]> {
    await this.init();
    const inv = await getInvoke();
    return inv<HourlyLogCount[]>('get_hourly_log_counts', { options });
  }

  async getLogTimeRange(channel: string): Promise<LogTimeRange> {
    await this.init();
    const inv = await getInvoke();
    return inv<LogTimeRange>('get_log_time_range', { channel });
  }

  async getLogIndexByTime(options: GetLogIndexByTimeOptions): Promise<number> {
    await this.init();
    const inv = await getInvoke();
    return inv<number>('get_log_index_by_time', { options });
  }

  async getSearchMatchCount(options: SearchMatchCountOptions): Promise<number> {
    await this.init();
    const inv = await getInvoke();
    return inv<number>('get_search_match_count', { options });
  }

  async pruneOldLogs(options?: PruneOptions): Promise<void> {
    await this.init();
    const inv = await getInvoke();
    await inv('prune_old_logs', { options });
  }
}
