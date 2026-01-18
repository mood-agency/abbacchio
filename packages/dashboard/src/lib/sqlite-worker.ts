import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const DB_PATH = '/abbacchio-logs.sqlite3';

// Type for SQLite row data
type SQLiteRow = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;

// ============================================================================
// Counter Cache - In-memory counters for O(1) lookups
// ============================================================================

interface ChannelCounters {
  total: number;
  levels: Record<string, number>;
  namespaces: Record<string, number>;
}

// Counters for a single time bucket
interface BucketCounters {
  total: number;
  levels: Record<string, number>;
  namespaces: Record<string, number>;
}

// Cache of counters per channel (global totals)
const counterCache = new Map<string, ChannelCounters>();

// Time-bucketed counters: channel -> (hourTimestamp -> counters)
// Buckets are 1-hour intervals for efficient time-range queries
const timeBuckets = new Map<string, Map<number, BucketCounters>>();

// Bucket size: 1 hour in milliseconds
const BUCKET_SIZE_MS = 60 * 60 * 1000;

// Whether cache has been initialized from SQLite
let cacheInitialized = false;

// Truncate timestamp to bucket boundary (start of hour)
function getBucketTimestamp(time: number): number {
  return Math.floor(time / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
}

function getOrCreateChannelCounters(channel: string): ChannelCounters {
  let counters = counterCache.get(channel);
  if (!counters) {
    counters = {
      total: 0,
      levels: { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 },
      namespaces: {},
    };
    counterCache.set(channel, counters);
  }
  return counters;
}

function getOrCreateBucket(channel: string, bucketTime: number): BucketCounters {
  let channelBuckets = timeBuckets.get(channel);
  if (!channelBuckets) {
    channelBuckets = new Map();
    timeBuckets.set(channel, channelBuckets);
  }

  let bucket = channelBuckets.get(bucketTime);
  if (!bucket) {
    bucket = {
      total: 0,
      levels: { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 },
      namespaces: {},
    };
    channelBuckets.set(bucketTime, bucket);
  }
  return bucket;
}

function incrementCounters(channel: string, levelLabel: string, namespace: string | null, time: number): void {
  // Update global counters
  const counters = getOrCreateChannelCounters(channel);
  counters.total++;
  counters.levels[levelLabel] = (counters.levels[levelLabel] || 0) + 1;
  if (namespace) {
    counters.namespaces[namespace] = (counters.namespaces[namespace] || 0) + 1;
  }

  // Update time bucket
  const bucketTime = getBucketTimestamp(time);
  const bucket = getOrCreateBucket(channel, bucketTime);
  bucket.total++;
  bucket.levels[levelLabel] = (bucket.levels[levelLabel] || 0) + 1;
  if (namespace) {
    bucket.namespaces[namespace] = (bucket.namespaces[namespace] || 0) + 1;
  }
}

// Aggregate counters from buckets within a time range
function aggregateBucketsFromTime(channel: string, minTime: number): { levels: Record<string, number>; namespaces: Record<string, number>; total: number } {
  const result = {
    total: 0,
    levels: { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 } as Record<string, number>,
    namespaces: {} as Record<string, number>,
  };

  const channelBuckets = timeBuckets.get(channel);
  if (!channelBuckets) return result;

  // Iterate over buckets that could contain logs >= minTime
  channelBuckets.forEach((bucket, bucketTime) => {
    // Include bucket if it could contain logs >= minTime
    // A bucket starting at bucketTime contains logs from [bucketTime, bucketTime + BUCKET_SIZE_MS)
    if (bucketTime + BUCKET_SIZE_MS > minTime) {
      result.total += bucket.total;
      for (const level of Object.keys(bucket.levels)) {
        result.levels[level] = (result.levels[level] || 0) + bucket.levels[level];
      }
      for (const ns of Object.keys(bucket.namespaces)) {
        result.namespaces[ns] = (result.namespaces[ns] || 0) + bucket.namespaces[ns];
      }
    }
  });

  return result;
}

function resetChannelCounters(channel: string): void {
  counterCache.delete(channel);
  timeBuckets.delete(channel);
}

function resetAllCounters(): void {
  counterCache.clear();
  timeBuckets.clear();
  cacheInitialized = false;
}

// Initialize cache from SQLite (called on init or refresh)
function initializeCacheFromDB(): void {
  if (!db) return;

  counterCache.clear();
  timeBuckets.clear();

  // Get all level counts grouped by channel
  db.exec({
    sql: `SELECT channel, level_label, COUNT(*) as count FROM logs GROUP BY channel, level_label`,
    rowMode: 'object',
    callback: (row: SQLiteRow) => {
      const r = row as { channel: string; level_label: string; count: number };
      const counters = getOrCreateChannelCounters(r.channel);
      counters.levels[r.level_label] = r.count;
      counters.total += r.count;
    },
  });

  // Get all namespace counts grouped by channel
  db.exec({
    sql: `SELECT channel, namespace, COUNT(*) as count FROM logs WHERE namespace IS NOT NULL GROUP BY channel, namespace`,
    rowMode: 'object',
    callback: (row: SQLiteRow) => {
      const r = row as { channel: string; namespace: string; count: number };
      const counters = getOrCreateChannelCounters(r.channel);
      counters.namespaces[r.namespace] = r.count;
    },
  });

  // Populate time buckets - group by channel, hour bucket, and level
  db.exec({
    sql: `SELECT channel, (time / ${BUCKET_SIZE_MS}) * ${BUCKET_SIZE_MS} as bucket_time, level_label, COUNT(*) as count
          FROM logs GROUP BY channel, bucket_time, level_label`,
    rowMode: 'object',
    callback: (row: SQLiteRow) => {
      const r = row as { channel: string; bucket_time: number; level_label: string; count: number };
      const bucket = getOrCreateBucket(r.channel, r.bucket_time);
      bucket.levels[r.level_label] = r.count;
      bucket.total += r.count;
    },
  });

  // Populate time buckets for namespaces
  db.exec({
    sql: `SELECT channel, (time / ${BUCKET_SIZE_MS}) * ${BUCKET_SIZE_MS} as bucket_time, namespace, COUNT(*) as count
          FROM logs WHERE namespace IS NOT NULL GROUP BY channel, bucket_time, namespace`,
    rowMode: 'object',
    callback: (row: SQLiteRow) => {
      const r = row as { channel: string; bucket_time: number; namespace: string; count: number };
      const bucket = getOrCreateBucket(r.channel, r.bucket_time);
      bucket.namespaces[r.namespace] = r.count;
    },
  });

  cacheInitialized = true;
}

async function initDB() {
  const sqlite3 = await sqlite3InitModule({
    print: console.log,
    printErr: console.error,
  });

  // Check if OPFS is available
  if ('opfs' in sqlite3) {
    console.log('OPFS is available, using persistent storage');
    db = new sqlite3.oo1.OpfsDb(DB_PATH);
  } else {
    console.log('OPFS not available, using in-memory database');
    db = new sqlite3.oo1.DB(':memory:', 'c');
  }

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      level INTEGER NOT NULL,
      level_label TEXT NOT NULL,
      time INTEGER NOT NULL,
      msg TEXT NOT NULL,
      namespace TEXT,
      channel TEXT NOT NULL,
      data TEXT NOT NULL,
      encrypted INTEGER DEFAULT 0,
      encrypted_data TEXT,
      decryption_failed INTEGER DEFAULT 0,
      was_encrypted INTEGER DEFAULT 0
    )
  `);

  // Add was_encrypted column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE logs ADD COLUMN was_encrypted INTEGER DEFAULT 0`);
  } catch {
    // Column already exists, ignore error
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time)`);

  // FTS5 for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
      msg, namespace, channel, data,
      content='logs', content_rowid='rowid'
    )
  `);

  // Triggers for FTS sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS logs_ai AFTER INSERT ON logs BEGIN
      INSERT INTO logs_fts(rowid, msg, namespace, channel, data)
      VALUES (new.rowid, new.msg, new.namespace, new.channel, new.data);
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS logs_ad AFTER DELETE ON logs BEGIN
      INSERT INTO logs_fts(logs_fts, rowid, msg, namespace, channel, data)
      VALUES ('delete', old.rowid, old.msg, old.namespace, old.channel, old.data);
    END
  `);

  // Initialize counter cache from existing data
  initializeCacheFromDB();

  return true;
}

// Determine if we should use LIKE (substring) or FTS5 (full-text)
// Use LIKE for: short terms (≤3 chars) or numeric patterns
function shouldUseLikeSearch(term: string): boolean {
  const trimmed = term.trim();
  return trimmed.length <= 3 || /^\d+$/.test(trimmed);
}

type MessageData = {
  id: number;
  action: string;
  payload?: unknown;
};

self.onmessage = async (e: MessageEvent<MessageData>) => {
  const { id, action, payload } = e.data;

  try {
    if (action === 'init') {
      await initDB();
      self.postMessage({ id, success: true });
      return;
    }

    if (!db) {
      throw new Error('Database not initialized');
    }

    switch (action) {
      case 'insertLogs': {
        const logs = payload as Array<{
          id: string;
          level: number;
          levelLabel: string;
          time: number;
          msg: string;
          namespace?: string;
          channel: string;
          data: Record<string, unknown>;
          encrypted?: boolean;
          encryptedData?: string;
          decryptionFailed?: boolean;
          wasEncrypted?: boolean;
        }>;

        db.exec('BEGIN TRANSACTION');
        try {
          for (const log of logs) {
            db.exec({
              sql: `INSERT OR REPLACE INTO logs (id, level, level_label, time, msg, namespace, channel, data, encrypted, encrypted_data, decryption_failed, was_encrypted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              bind: [
                log.id,
                log.level,
                log.levelLabel,
                log.time,
                log.msg,
                log.namespace ?? null,
                log.channel,
                JSON.stringify(log.data),
                log.encrypted ? 1 : 0,
                log.encryptedData ?? null,
                log.decryptionFailed ? 1 : 0,
                log.wasEncrypted ? 1 : 0,
              ],
            });

            // Update in-memory counters and time buckets O(1)
            incrementCounters(log.channel, log.levelLabel, log.namespace ?? null, log.time);
          }
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        self.postMessage({ id, success: true });
        break;
      }

      case 'queryLogs': {
        const options = payload as {
          search?: string;
          levels?: string[];
          namespaces?: string[];
          minTime?: number;
          channel?: string;
          limit?: number;
          offset?: number;
        };

        const conditions: string[] = [];
        const params: (string | number | null)[] = [];

        // Filter by channel first (exact match)
        if (options.channel) {
          conditions.push(`logs.channel = ?`);
          params.push(options.channel);
        }

        // Filter by time range
        if (options.minTime && options.minTime > 0) {
          conditions.push(`logs.time >= ?`);
          params.push(options.minTime);
        }

        if (options.search?.trim()) {
          const searchTerm = options.search.trim().replace(/['"]/g, '');
          if (shouldUseLikeSearch(searchTerm)) {
            // Use LIKE for substring matching (short terms or numeric patterns)
            conditions.push(`(logs.msg LIKE ? OR logs.data LIKE ? OR logs.namespace LIKE ? OR logs.channel LIKE ?)`);
            const likePattern = `%${searchTerm}%`;
            params.push(likePattern, likePattern, likePattern, likePattern);
          } else {
            // Use FTS5 for full-text search (longer text terms)
            conditions.push(`logs.rowid IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?)`);
            params.push(`"${searchTerm}"*`);
          }
        }

        // Filter by multiple levels (empty array = all levels)
        if (options.levels && options.levels.length > 0) {
          const placeholders = options.levels.map(() => '?').join(', ');
          conditions.push(`logs.level_label IN (${placeholders})`);
          params.push(...options.levels);
        }

        // Filter by multiple namespaces (empty array = all namespaces)
        if (options.namespaces && options.namespaces.length > 0) {
          const placeholders = options.namespaces.map(() => '?').join(', ');
          conditions.push(`logs.namespace IN (${placeholders})`);
          params.push(...options.namespaces);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        let sql = `SELECT * FROM logs ${where} ORDER BY time DESC`;

        if (options.limit !== undefined) {
          sql += ` LIMIT ?`;
          params.push(options.limit);
          if (options.offset !== undefined) {
            sql += ` OFFSET ?`;
            params.push(options.offset);
          }
        }

        const rows: Record<string, unknown>[] = [];
        db.exec({
          sql,
          bind: params,
          rowMode: 'object',
          callback: (row: SQLiteRow) => rows.push(row as Record<string, unknown>),
        });

        self.postMessage({ id, success: true, result: rows });
        break;
      }

      case 'getFilteredCount': {
        const options = payload as {
          search?: string;
          levels?: string[];
          namespaces?: string[];
          minTime?: number;
          channel?: string;
        };

        const conditions: string[] = [];
        const params: (string | number | null)[] = [];

        // Filter by channel first (exact match)
        if (options.channel) {
          conditions.push(`logs.channel = ?`);
          params.push(options.channel);
        }

        // Filter by time range
        if (options.minTime && options.minTime > 0) {
          conditions.push(`logs.time >= ?`);
          params.push(options.minTime);
        }

        if (options.search?.trim()) {
          const searchTerm = options.search.trim().replace(/['"]/g, '');
          if (shouldUseLikeSearch(searchTerm)) {
            // Use LIKE for substring matching (short terms or numeric patterns)
            conditions.push(`(logs.msg LIKE ? OR logs.data LIKE ? OR logs.namespace LIKE ? OR logs.channel LIKE ?)`);
            const likePattern = `%${searchTerm}%`;
            params.push(likePattern, likePattern, likePattern, likePattern);
          } else {
            // Use FTS5 for full-text search (longer text terms)
            conditions.push(`logs.rowid IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?)`);
            params.push(`"${searchTerm}"*`);
          }
        }

        // Filter by multiple levels (empty array = all levels)
        if (options.levels && options.levels.length > 0) {
          const placeholders = options.levels.map(() => '?').join(', ');
          conditions.push(`logs.level_label IN (${placeholders})`);
          params.push(...options.levels);
        }

        // Filter by multiple namespaces (empty array = all namespaces)
        if (options.namespaces && options.namespaces.length > 0) {
          const placeholders = options.namespaces.map(() => '?').join(', ');
          conditions.push(`logs.namespace IN (${placeholders})`);
          params.push(...options.namespaces);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        let count = 0;
        db.exec({
          sql: `SELECT COUNT(*) as count FROM logs ${where}`,
          bind: params,
          rowMode: 'object',
          callback: (row: SQLiteRow) => { count = (row as { count: number }).count; },
        });

        self.postMessage({ id, success: true, result: count });
        break;
      }

      case 'getLogCount': {
        let count = 0;
        db.exec({
          sql: 'SELECT COUNT(*) as count FROM logs',
          rowMode: 'object',
          callback: (row: SQLiteRow) => { count = (row as { count: number }).count; },
        });
        self.postMessage({ id, success: true, result: count });
        break;
      }

      case 'getDistinctNamespaces': {
        const options = payload as { channel?: string } | undefined;
        const namespaces: string[] = [];
        if (options?.channel) {
          db.exec({
            sql: `SELECT DISTINCT namespace FROM logs WHERE namespace IS NOT NULL AND channel = ? ORDER BY namespace`,
            bind: [options.channel],
            rowMode: 'object',
            callback: (row: SQLiteRow) => namespaces.push((row as { namespace: string }).namespace),
          });
        } else {
          db.exec({
            sql: `SELECT DISTINCT namespace FROM logs WHERE namespace IS NOT NULL ORDER BY namespace`,
            rowMode: 'object',
            callback: (row: SQLiteRow) => namespaces.push((row as { namespace: string }).namespace),
          });
        }
        self.postMessage({ id, success: true, result: namespaces });
        break;
      }

      case 'clearAllLogs': {
        db.exec('DELETE FROM logs');
        db.exec("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')");
        // Reset all in-memory counters
        resetAllCounters();
        self.postMessage({ id, success: true });
        break;
      }

      case 'clearLogsForChannel': {
        const options = payload as { channel: string };
        db.exec({
          sql: 'DELETE FROM logs WHERE channel = ?',
          bind: [options.channel],
        });
        db.exec("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')");
        // Reset counters for this channel
        resetChannelCounters(options.channel);
        self.postMessage({ id, success: true });
        break;
      }

      case 'hasEncryptedLogs': {
        const options = payload as { channel?: string } | undefined;
        let count = 0;
        if (options?.channel) {
          db.exec({
            sql: 'SELECT COUNT(*) as count FROM logs WHERE (encrypted = 1 OR decryption_failed = 1) AND channel = ?',
            bind: [options.channel],
            rowMode: 'object',
            callback: (row: SQLiteRow) => { count = (row as { count: number }).count; },
          });
        } else {
          db.exec({
            sql: 'SELECT COUNT(*) as count FROM logs WHERE encrypted = 1 OR decryption_failed = 1',
            rowMode: 'object',
            callback: (row: SQLiteRow) => { count = (row as { count: number }).count; },
          });
        }
        self.postMessage({ id, success: true, result: count > 0 });
        break;
      }

      case 'getLogsNeedingDecryption': {
        const options = payload as { channel?: string } | undefined;
        const rows: Record<string, unknown>[] = [];
        if (options?.channel) {
          db.exec({
            sql: `SELECT * FROM logs WHERE ((encrypted = 1 AND encrypted_data IS NOT NULL) OR (decryption_failed = 1 AND encrypted_data IS NOT NULL)) AND channel = ?`,
            bind: [options.channel],
            rowMode: 'object',
            callback: (row: SQLiteRow) => rows.push(row as Record<string, unknown>),
          });
        } else {
          db.exec({
            sql: `SELECT * FROM logs WHERE (encrypted = 1 AND encrypted_data IS NOT NULL) OR (decryption_failed = 1 AND encrypted_data IS NOT NULL)`,
            rowMode: 'object',
            callback: (row: SQLiteRow) => rows.push(row as Record<string, unknown>),
          });
        }
        self.postMessage({ id, success: true, result: rows });
        break;
      }

      case 'getLevelCounts': {
        const options = payload as { channel?: string; minTime?: number };
        const hasTimeFilter = options?.minTime && options.minTime > 0;

        // Use in-memory cache when no time filter (O(1) lookup)
        if (!hasTimeFilter && options?.channel && cacheInitialized) {
          const counters = counterCache.get(options.channel);
          const counts: Record<string, number> = {
            all: counters?.total || 0,
            trace: counters?.levels.trace || 0,
            debug: counters?.levels.debug || 0,
            info: counters?.levels.info || 0,
            warn: counters?.levels.warn || 0,
            error: counters?.levels.error || 0,
            fatal: counters?.levels.fatal || 0,
          };
          self.postMessage({ id, success: true, result: counts });
          break;
        }

        // Use time buckets when time filter is active O(buckets)
        if (hasTimeFilter && options?.channel && cacheInitialized) {
          const aggregated = aggregateBucketsFromTime(options.channel, options.minTime!);
          const counts: Record<string, number> = {
            all: aggregated.total,
            trace: aggregated.levels.trace || 0,
            debug: aggregated.levels.debug || 0,
            info: aggregated.levels.info || 0,
            warn: aggregated.levels.warn || 0,
            error: aggregated.levels.error || 0,
            fatal: aggregated.levels.fatal || 0,
          };
          self.postMessage({ id, success: true, result: counts });
          break;
        }

        // Fall back to SQLite query when cache not initialized
        const conditions: string[] = [];
        const params: (string | number | null)[] = [];

        if (options?.channel) {
          conditions.push(`channel = ?`);
          params.push(options.channel);
        }

        if (hasTimeFilter) {
          conditions.push(`time >= ?`);
          params.push(options.minTime!);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const counts: Record<string, number> = {
          all: 0,
          trace: 0,
          debug: 0,
          info: 0,
          warn: 0,
          error: 0,
          fatal: 0,
        };

        // Get total count
        db.exec({
          sql: `SELECT COUNT(*) as count FROM logs ${where}`,
          bind: params,
          rowMode: 'object',
          callback: (row: SQLiteRow) => { counts.all = (row as { count: number }).count; },
        });

        // Get counts per level
        db.exec({
          sql: `SELECT level_label, COUNT(*) as count FROM logs ${where} GROUP BY level_label`,
          bind: params,
          rowMode: 'object',
          callback: (row: SQLiteRow) => {
            const r = row as { level_label: string; count: number };
            if (r.level_label in counts) {
              counts[r.level_label] = r.count;
            }
          },
        });

        self.postMessage({ id, success: true, result: counts });
        break;
      }

      case 'getNamespaceCounts': {
        const options = payload as { channel?: string; minTime?: number };
        const hasTimeFilter = options?.minTime && options.minTime > 0;

        // Use in-memory cache when no time filter (O(1) lookup)
        if (!hasTimeFilter && options?.channel && cacheInitialized) {
          const counters = counterCache.get(options.channel);
          const counts: Record<string, number> = { ...(counters?.namespaces || {}) };
          self.postMessage({ id, success: true, result: counts });
          break;
        }

        // Use time buckets when time filter is active O(buckets)
        if (hasTimeFilter && options?.channel && cacheInitialized) {
          const aggregated = aggregateBucketsFromTime(options.channel, options.minTime!);
          self.postMessage({ id, success: true, result: aggregated.namespaces });
          break;
        }

        // Fall back to SQLite query when cache not initialized
        const conditions: string[] = ['namespace IS NOT NULL'];
        const params: (string | number | null)[] = [];

        if (options?.channel) {
          conditions.push(`channel = ?`);
          params.push(options.channel);
        }

        if (hasTimeFilter) {
          conditions.push(`time >= ?`);
          params.push(options.minTime!);
        }

        const where = `WHERE ${conditions.join(' AND ')}`;
        const counts: Record<string, number> = {};

        // Get counts per namespace
        db.exec({
          sql: `SELECT namespace, COUNT(*) as count FROM logs ${where} GROUP BY namespace ORDER BY namespace`,
          bind: params,
          rowMode: 'object',
          callback: (row: SQLiteRow) => {
            const r = row as { namespace: string; count: number };
            counts[r.namespace] = r.count;
          },
        });

        self.postMessage({ id, success: true, result: counts });
        break;
      }

      case 'getDatabaseStats': {
        const stats = {
          channelCount: 0,
          totalRecords: 0,
          databaseSize: 0,
        };

        // Get number of distinct channels
        db.exec({
          sql: 'SELECT COUNT(DISTINCT channel) as count FROM logs',
          rowMode: 'object',
          callback: (row: SQLiteRow) => { stats.channelCount = (row as { count: number }).count; },
        });

        // Get total number of records
        db.exec({
          sql: 'SELECT COUNT(*) as count FROM logs',
          rowMode: 'object',
          callback: (row: SQLiteRow) => { stats.totalRecords = (row as { count: number }).count; },
        });

        // Get database size (page_count * page_size)
        db.exec({
          sql: 'SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()',
          rowMode: 'object',
          callback: (row: SQLiteRow) => { stats.databaseSize = (row as { size: number }).size; },
        });

        self.postMessage({ id, success: true, result: stats });
        break;
      }

      case 'getSearchMatchCount': {
        const options = payload as {
          search: string;
          channel?: string;
          minTime?: number;
          levels?: string[];
          namespaces?: string[];
          logIds?: string[];
        };

        if (!options.search?.trim()) {
          self.postMessage({ id, success: true, result: 0 });
          break;
        }

        const searchTerm = options.search.trim().replace(/['"]/g, '');
        const conditions: string[] = [];
        const params: (string | number)[] = [];

        // Filter by channel
        if (options.channel) {
          conditions.push(`channel = ?`);
          params.push(options.channel);
        }

        // Filter by time range
        if (options.minTime && options.minTime > 0) {
          conditions.push(`time >= ?`);
          params.push(options.minTime);
        }

        // Filter by levels
        if (options.levels && options.levels.length > 0) {
          const placeholders = options.levels.map(() => '?').join(', ');
          conditions.push(`level_label IN (${placeholders})`);
          params.push(...options.levels);
        }

        // Filter by namespaces
        if (options.namespaces && options.namespaces.length > 0) {
          const placeholders = options.namespaces.map(() => '?').join(', ');
          conditions.push(`namespace IN (${placeholders})`);
          params.push(...options.namespaces);
        }

        // Filter by specific log IDs (for current page only)
        if (options.logIds && options.logIds.length > 0) {
          const placeholders = options.logIds.map(() => '?').join(', ');
          conditions.push(`id IN (${placeholders})`);
          params.push(...options.logIds);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Count matches in msg and data fields using SQLite's instr() for case-insensitive counting
        // We count occurrences by recursively finding matches
        let totalMatches = 0;
        const lowerSearch = searchTerm.toLowerCase();

        db.exec({
          sql: `SELECT msg, data FROM logs ${where}`,
          bind: params,
          rowMode: 'object',
          callback: (row: { msg: string; data: string }) => {
            const r = row;
            // Count matches in msg
            const msgLower = (r.msg || '').toLowerCase();
            let pos = 0;
            while ((pos = msgLower.indexOf(lowerSearch, pos)) !== -1) {
              totalMatches++;
              pos += lowerSearch.length;
            }
            // Count matches in data
            const dataLower = (r.data || '').toLowerCase();
            pos = 0;
            while ((pos = dataLower.indexOf(lowerSearch, pos)) !== -1) {
              totalMatches++;
              pos += lowerSearch.length;
            }
          },
        });

        self.postMessage({ id, success: true, result: totalMatches });
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    self.postMessage({ id, success: false, error: String(error) });
  }
};
