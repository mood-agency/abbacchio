import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const DB_PATH = '/abbacchio-logs.sqlite3';

// Type for SQLite row data
type SQLiteRow = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;

// ============================================================================
// Hot Buffer - In-memory ring buffer for recent logs (microsecond access)
// ============================================================================

interface LogEntry {
  id: string;
  level: number;
  level_label: string;
  time: number;
  msg: string;
  namespace: string | null;
  channel: string;
  data: string;
  encrypted: number;
  encrypted_data: string | null;
  decryption_failed: number;
  was_encrypted: number;
}

// Ring buffer for recent logs per channel
const hotBuffers = new Map<string, LogEntry[]>();
const HOT_BUFFER_MAX_SIZE = 5000; // Keep last 5k logs per channel in memory

function getOrCreateHotBuffer(channel: string): LogEntry[] {
  let buffer = hotBuffers.get(channel);
  if (!buffer) {
    buffer = [];
    hotBuffers.set(channel, buffer);
  }
  return buffer;
}

function addToHotBuffer(channel: string, log: LogEntry): void {
  const buffer = getOrCreateHotBuffer(channel);
  buffer.push(log);
  // Trim if exceeds max size (FIFO)
  if (buffer.length > HOT_BUFFER_MAX_SIZE) {
    buffer.shift();
  }
}

function clearHotBuffer(channel: string): void {
  hotBuffers.delete(channel);
}

function clearAllHotBuffers(): void {
  hotBuffers.clear();
}

/**
 * Test if a regex matches a string with a non-empty match.
 * This prevents patterns like "foo|" from matching everything via empty string.
 */
function regexMatchesNonEmpty(regex: RegExp, text: string): boolean {
  regex.lastIndex = 0;
  const match = regex.exec(text);
  return match !== null && match[0].length > 0;
}

// Query hot buffer with filters - returns matching logs in descending time order
function queryHotBuffer(
  channel: string,
  options: {
    levels?: string[];
    namespaces?: string[];
    minTime?: number;
    search?: string;
    useRegex?: boolean;
    caseSensitive?: boolean;
    limit?: number;
    offset?: number;
  }
): { logs: LogEntry[]; total: number } {
  const buffer = hotBuffers.get(channel);
  if (!buffer || buffer.length === 0) {
    return { logs: [], total: 0 };
  }

  // Build regex if needed
  let searchRegex: RegExp | null = null;
  if (options.search && options.useRegex) {
    try {
      const flags = options.caseSensitive ? 'g' : 'gi';
      searchRegex = new RegExp(options.search, flags);
    } catch {
      // Invalid regex, fall back to literal search
      searchRegex = null;
    }
  }

  // Filter logs
  let filtered = buffer.filter(log => {
    if (options.minTime && options.minTime > 0 && log.time < options.minTime) return false;
    if (options.levels && options.levels.length > 0 && !options.levels.includes(log.level_label)) return false;
    if (options.namespaces && options.namespaces.length > 0 && (!log.namespace || !options.namespaces.includes(log.namespace))) return false;
    if (options.search) {
      if (searchRegex) {
        // Regex search - also search level_label for patterns like TRACE|DEBUG
        // Use non-empty match check to prevent patterns like "foo|" from matching everything
        const msgMatch = regexMatchesNonEmpty(searchRegex, log.msg);
        const dataMatch = regexMatchesNonEmpty(searchRegex, log.data);
        const nsMatch = log.namespace ? regexMatchesNonEmpty(searchRegex, log.namespace) : false;
        const levelMatch = regexMatchesNonEmpty(searchRegex, log.level_label);
        if (!msgMatch && !dataMatch && !nsMatch && !levelMatch) return false;
      } else {
        // Plain text search
        const searchTerm = options.caseSensitive ? options.search : options.search.toLowerCase();
        const msgToCheck = options.caseSensitive ? log.msg : log.msg.toLowerCase();
        const dataToCheck = options.caseSensitive ? log.data : log.data.toLowerCase();
        const nsToCheck = log.namespace ? (options.caseSensitive ? log.namespace : log.namespace.toLowerCase()) : '';
        const msgMatch = msgToCheck.includes(searchTerm);
        const dataMatch = dataToCheck.includes(searchTerm);
        const nsMatch = nsToCheck.includes(searchTerm);
        if (!msgMatch && !dataMatch && !nsMatch) return false;
      }
    }
    return true;
  });

  const total = filtered.length;

  // Sort by time descending (most recent first)
  filtered.sort((a, b) => b.time - a.time);

  // Apply pagination
  const offset = options.offset || 0;
  const limit = options.limit || 100;
  const logs = filtered.slice(offset, offset + limit);

  return { logs, total };
}

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

  // Indexes for common query patterns
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_channel_time ON logs(channel, time DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_channel_level_time ON logs(channel, level_label, time DESC)`);

  // FTS5 for full-text search (lazy - created but triggers are conditional)
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
            const dataStr = JSON.stringify(log.data);

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
                dataStr,
                log.encrypted ? 1 : 0,
                log.encryptedData ?? null,
                log.decryptionFailed ? 1 : 0,
                log.wasEncrypted ? 1 : 0,
              ],
            });

            // Update in-memory counters and time buckets O(1)
            incrementCounters(log.channel, log.levelLabel, log.namespace ?? null, log.time);

            // Add to hot buffer for fast in-memory queries
            addToHotBuffer(log.channel, {
              id: log.id,
              level: log.level,
              level_label: log.levelLabel,
              time: log.time,
              msg: log.msg,
              namespace: log.namespace ?? null,
              channel: log.channel,
              data: dataStr,
              encrypted: log.encrypted ? 1 : 0,
              encrypted_data: log.encryptedData ?? null,
              decryption_failed: log.decryptionFailed ? 1 : 0,
              was_encrypted: log.wasEncrypted ? 1 : 0,
            });
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
          useRegex?: boolean;
          caseSensitive?: boolean;
          levels?: string[];
          namespaces?: string[];
          minTime?: number;
          channel?: string;
          limit?: number;
          offset?: number;
        };

        const limit = options.limit ?? 100;
        const offset = options.offset ?? 0;

        // Try hot buffer first for recent logs (page 1 with no complex filters)
        if (options.channel && offset === 0) {
          const hotResult = queryHotBuffer(options.channel, {
            levels: options.levels,
            namespaces: options.namespaces,
            minTime: options.minTime,
            search: options.search?.trim(),
            useRegex: options.useRegex,
            caseSensitive: options.caseSensitive,
            limit,
            offset: 0,
          });

          // If hot buffer has enough results, return them directly (microseconds)
          if (hotResult.logs.length >= limit) {
            self.postMessage({ id, success: true, result: hotResult.logs });
            break;
          }
        }

        // Fall back to SQLite for older logs or complex queries
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
          if (options.useRegex) {
            // Regex search - we need to load all matching rows and filter in JS
            // SQLite doesn't support regex natively, so we skip LIKE pre-filtering
            // for complex patterns (containing | for OR, ^ for start, $ for end, etc.)
            // and just apply regex in post-processing on all results
            // For simpler patterns, we can still use LIKE to narrow down
            // Skip LIKE pre-filter for complex regex patterns:
            // - | for OR, ^ $ for anchors, () for groups, [] for character classes
            // - \ for escape sequences like \w, \d, \s, etc.
            const hasComplexRegex = /[|^$()[\]\\]/.test(searchTerm);
            if (!hasComplexRegex) {
              // Simple regex - can use LIKE to pre-filter
              conditions.push(`(logs.msg LIKE ? OR logs.data LIKE ? OR logs.namespace LIKE ?)`);
              const likePattern = `%${searchTerm.replace(/[.*+?]/g, '%')}%`;
              params.push(likePattern, likePattern, likePattern);
            }
            // For complex regex (OR patterns, anchors, escape sequences, etc.), skip LIKE pre-filter
            // The regex will be applied in post-processing
          } else if (shouldUseLikeSearch(searchTerm)) {
            // Use LIKE for substring matching (short terms or numeric patterns)
            const likePattern = options.caseSensitive ? `%${searchTerm}%` : `%${searchTerm.toLowerCase()}%`;
            if (options.caseSensitive) {
              conditions.push(`(logs.msg LIKE ? OR logs.data LIKE ? OR logs.namespace LIKE ? OR logs.channel LIKE ?)`);
            } else {
              conditions.push(`(LOWER(logs.msg) LIKE ? OR LOWER(logs.data) LIKE ? OR LOWER(logs.namespace) LIKE ? OR LOWER(logs.channel) LIKE ?)`);
            }
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

        // Apply pagination
        // For regex queries without LIKE pre-filter, we need to be careful:
        // - Can't use SQL OFFSET because we filter in JS after fetching
        // - Need enough rows to fill the requested limit after filtering
        const searchTerm = options.search?.trim();
        const hasComplexRegex = options.useRegex && searchTerm && /[|^$()[\]\\]/.test(searchTerm);

        sql += ` LIMIT ?`;
        if (hasComplexRegex) {
          // For complex regex, fetch more rows to ensure we have enough after filtering
          // But cap at 200k to avoid memory issues on very large datasets
          params.push(Math.min(limit * 2, 200000));
        } else {
          params.push(limit);
          if (offset > 0) {
            sql += ` OFFSET ?`;
            params.push(offset);
          }
        }

        let rows: Record<string, unknown>[] = [];
        db.exec({
          sql,
          bind: params,
          rowMode: 'object',
          callback: (row: SQLiteRow) => rows.push(row as Record<string, unknown>),
        });

        // Apply regex filter in post-processing if needed
        if (options.useRegex && options.search?.trim()) {
          try {
            const flags = options.caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(options.search.trim(), flags);
            rows = rows.filter(row => {
              // Use non-empty match check to prevent patterns like "foo|" from matching everything
              const msgMatch = regexMatchesNonEmpty(regex, String(row.msg || ''));
              const dataMatch = regexMatchesNonEmpty(regex, String(row.data || ''));
              const nsMatch = row.namespace ? regexMatchesNonEmpty(regex, String(row.namespace)) : false;
              const levelMatch = regexMatchesNonEmpty(regex, String(row.level_label || ''));
              return msgMatch || dataMatch || nsMatch || levelMatch;
            });
          } catch {
            // Invalid regex, return empty results
            rows = [];
          }
          // For complex regex patterns, apply offset and limit after filtering
          // For simple regex patterns (with LIKE pre-filter), SQL already applied pagination
          const searchTerm = options.search.trim();
          const hasComplexRegex = /[|^$()[\]\\]/.test(searchTerm);
          if (hasComplexRegex) {
            rows = rows.slice(offset, offset + limit);
          }
        }

        self.postMessage({ id, success: true, result: rows });
        break;
      }

      case 'getFilteredCount': {
        const options = payload as {
          search?: string;
          useRegex?: boolean;
          caseSensitive?: boolean;
          levels?: string[];
          namespaces?: string[];
          minTime?: number;
          channel?: string;
        };

        // Fast path: no filters except channel and maybe time - use counter cache
        const hasLevelFilter = options.levels && options.levels.length > 0;
        const hasNamespaceFilter = options.namespaces && options.namespaces.length > 0;
        const hasSearchFilter = options.search?.trim();
        const hasTimeFilter = options.minTime && options.minTime > 0;

        if (options.channel && !hasLevelFilter && !hasNamespaceFilter && !hasSearchFilter && cacheInitialized) {
          // Use in-memory counters O(1)
          if (!hasTimeFilter) {
            const counters = counterCache.get(options.channel);
            self.postMessage({ id, success: true, result: counters?.total || 0 });
            break;
          } else {
            // Use time bucket aggregation O(buckets)
            const aggregated = aggregateBucketsFromTime(options.channel, options.minTime!);
            self.postMessage({ id, success: true, result: aggregated.total });
            break;
          }
        }

        // If filtering by levels only (no search, no namespace), compute from cache
        if (options.channel && hasLevelFilter && !hasNamespaceFilter && !hasSearchFilter && cacheInitialized) {
          if (!hasTimeFilter) {
            const counters = counterCache.get(options.channel);
            if (counters) {
              let total = 0;
              for (const level of options.levels!) {
                total += counters.levels[level] || 0;
              }
              self.postMessage({ id, success: true, result: total });
              break;
            }
          } else {
            const aggregated = aggregateBucketsFromTime(options.channel, options.minTime!);
            let total = 0;
            for (const level of options.levels!) {
              total += aggregated.levels[level] || 0;
            }
            self.postMessage({ id, success: true, result: total });
            break;
          }
        }

        // Fall back to SQLite for complex queries (search, namespace filters)
        const conditions: string[] = [];
        const params: (string | number | null)[] = [];

        // Filter by channel first (exact match)
        if (options.channel) {
          conditions.push(`logs.channel = ?`);
          params.push(options.channel);
        }

        // Filter by time range
        if (hasTimeFilter) {
          conditions.push(`logs.time >= ?`);
          params.push(options.minTime!);
        }

        // For regex queries, we need to count in JS
        if (options.useRegex && hasSearchFilter) {
          const searchTerm = options.search!.trim();
          // Skip LIKE pre-filter for complex regex patterns:
          // - | for OR, ^ $ for anchors, () for groups, [] for character classes
          // - \ for escape sequences like \w, \d, \s, etc.
          const hasComplexRegex = /[|^$()[\]\\]/.test(searchTerm);
          if (!hasComplexRegex) {
            // Simple regex - can use LIKE to pre-filter
            conditions.push(`(logs.msg LIKE ? OR logs.data LIKE ? OR logs.namespace LIKE ?)`);
            const likePattern = `%${searchTerm.replace(/[.*+?]/g, '%')}%`;
            params.push(likePattern, likePattern, likePattern);
          }
          // For complex regex (OR patterns, anchors, escape sequences, etc.), skip LIKE pre-filter

          // Filter by levels
          if (hasLevelFilter) {
            const placeholders = options.levels!.map(() => '?').join(', ');
            conditions.push(`logs.level_label IN (${placeholders})`);
            params.push(...options.levels!);
          }

          // Filter by namespaces
          if (hasNamespaceFilter) {
            const placeholders = options.namespaces!.map(() => '?').join(', ');
            conditions.push(`logs.namespace IN (${placeholders})`);
            params.push(...options.namespaces!);
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const rows: Record<string, unknown>[] = [];
          db.exec({
            sql: `SELECT msg, data, namespace, level_label FROM logs ${where}`,
            bind: params,
            rowMode: 'object',
            callback: (row: SQLiteRow) => rows.push(row as Record<string, unknown>),
          });

          // Apply regex filter
          let count = 0;
          try {
            const flags = options.caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(searchTerm, flags);
            count = rows.filter(row => {
              // Use non-empty match check to prevent patterns like "foo|" from matching everything
              const msgMatch = regexMatchesNonEmpty(regex, String(row.msg || ''));
              const dataMatch = regexMatchesNonEmpty(regex, String(row.data || ''));
              const nsMatch = row.namespace ? regexMatchesNonEmpty(regex, String(row.namespace)) : false;
              const levelMatch = regexMatchesNonEmpty(regex, String(row.level_label || ''));
              return msgMatch || dataMatch || nsMatch || levelMatch;
            }).length;
          } catch {
            // Invalid regex
            count = 0;
          }

          self.postMessage({ id, success: true, result: count });
          break;
        }

        if (hasSearchFilter) {
          const searchTerm = options.search!.trim().replace(/['"]/g, '');
          if (shouldUseLikeSearch(searchTerm)) {
            // Use LIKE for substring matching (short terms or numeric patterns)
            const likePattern = options.caseSensitive ? `%${searchTerm}%` : `%${searchTerm.toLowerCase()}%`;
            if (options.caseSensitive) {
              conditions.push(`(logs.msg LIKE ? OR logs.data LIKE ? OR logs.namespace LIKE ? OR logs.channel LIKE ?)`);
            } else {
              conditions.push(`(LOWER(logs.msg) LIKE ? OR LOWER(logs.data) LIKE ? OR LOWER(logs.namespace) LIKE ? OR LOWER(logs.channel) LIKE ?)`);
            }
            params.push(likePattern, likePattern, likePattern, likePattern);
          } else {
            // Use FTS5 for full-text search (longer text terms)
            conditions.push(`logs.rowid IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?)`);
            params.push(`"${searchTerm}"*`);
          }
        }

        // Filter by multiple levels (empty array = all levels)
        if (hasLevelFilter) {
          const placeholders = options.levels!.map(() => '?').join(', ');
          conditions.push(`logs.level_label IN (${placeholders})`);
          params.push(...options.levels!);
        }

        // Filter by multiple namespaces (empty array = all namespaces)
        if (hasNamespaceFilter) {
          const placeholders = options.namespaces!.map(() => '?').join(', ');
          conditions.push(`logs.namespace IN (${placeholders})`);
          params.push(...options.namespaces!);
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
        // Reset all in-memory counters and hot buffers
        resetAllCounters();
        clearAllHotBuffers();
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
        // Reset counters and hot buffer for this channel
        resetChannelCounters(options.channel);
        clearHotBuffer(options.channel);
        self.postMessage({ id, success: true });
        break;
      }

      case 'pruneOldLogs': {
        // TTL cleanup: delete logs older than specified max age
        const options = payload as { maxAgeMs?: number };
        const maxAgeMs = options?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000; // Default 7 days
        const cutoffTime = Date.now() - maxAgeMs;

        db.exec({
          sql: 'DELETE FROM logs WHERE time < ?',
          bind: [cutoffTime],
        });
        db.exec("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')");

        // Re-initialize counters from remaining data
        initializeCacheFromDB();
        // Clear hot buffers (they only contain recent data anyway)
        clearAllHotBuffers();

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

      case 'getHourlyLogCounts': {
        const options = payload as { channel: string; minTime?: number };
        const channelBuckets = timeBuckets.get(options.channel);
        const result: Array<{ hour: number; count: number }> = [];

        if (channelBuckets) {
          channelBuckets.forEach((bucket, bucketTime) => {
            if (!options.minTime || bucketTime + BUCKET_SIZE_MS > options.minTime) {
              result.push({ hour: bucketTime, count: bucket.total });
            }
          });
          result.sort((a, b) => a.hour - b.hour);
        }

        self.postMessage({ id, success: true, result });
        break;
      }

      case 'getLogTimeRange': {
        const options = payload as { channel: string };
        let minTime: number | null = null;
        let maxTime: number | null = null;

        db.exec({
          sql: `SELECT MIN(time) as min_time, MAX(time) as max_time FROM logs WHERE channel = ?`,
          bind: [options.channel],
          rowMode: 'object',
          callback: (row: SQLiteRow) => {
            const r = row as { min_time: number | null; max_time: number | null };
            minTime = r.min_time;
            maxTime = r.max_time;
          },
        });

        self.postMessage({ id, success: true, result: { minTime, maxTime } });
        break;
      }

      case 'getLogIndexByTime': {
        const options = payload as {
          channel: string;
          targetTime: number;
          levels?: string[];
          namespaces?: string[];
          minTime?: number;
          search?: string;
        };

        // Count logs with time >= targetTime
        // Since logs are sorted DESC (newest first), this gives the index/offset
        // for the first log that is older than targetTime
        const conditions: string[] = ['channel = ?', 'time >= ?'];
        const params: (string | number)[] = [options.channel, options.targetTime];

        // Apply same filters as queryLogs
        if (options.minTime && options.minTime > 0) {
          conditions.push('time >= ?');
          params.push(options.minTime);
        }

        if (options.levels && options.levels.length > 0) {
          const placeholders = options.levels.map(() => '?').join(', ');
          conditions.push(`level_label IN (${placeholders})`);
          params.push(...options.levels);
        }

        if (options.namespaces && options.namespaces.length > 0) {
          const placeholders = options.namespaces.map(() => '?').join(', ');
          conditions.push(`namespace IN (${placeholders})`);
          params.push(...options.namespaces);
        }

        if (options.search?.trim()) {
          const searchTerm = options.search.trim().replace(/['"]/g, '');
          if (shouldUseLikeSearch(searchTerm)) {
            conditions.push(`(msg LIKE ? OR data LIKE ? OR namespace LIKE ?)`);
            const likePattern = `%${searchTerm}%`;
            params.push(likePattern, likePattern, likePattern);
          } else {
            conditions.push(`rowid IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ?)`);
            params.push(`"${searchTerm}"*`);
          }
        }

        let count = 0;
        db.exec({
          sql: `SELECT COUNT(*) as count FROM logs WHERE ${conditions.join(' AND ')}`,
          bind: params,
          rowMode: 'object',
          callback: (row: SQLiteRow) => {
            count = (row as { count: number }).count;
          },
        });

        self.postMessage({ id, success: true, result: count });
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
