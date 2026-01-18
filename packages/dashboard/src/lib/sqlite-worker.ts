import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const DB_PATH = '/abbacchio-logs.sqlite3';

let db: ReturnType<InstanceType<typeof import('@sqlite.org/sqlite-wasm').default>['oo1']['OpfsDb']> | null = null;

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
          callback: (row) => rows.push(row as Record<string, unknown>),
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
          callback: (row) => { count = (row as { count: number }).count; },
        });

        self.postMessage({ id, success: true, result: count });
        break;
      }

      case 'getLogCount': {
        let count = 0;
        db.exec({
          sql: 'SELECT COUNT(*) as count FROM logs',
          rowMode: 'object',
          callback: (row) => { count = (row as { count: number }).count; },
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
            callback: (row) => namespaces.push((row as { namespace: string }).namespace),
          });
        } else {
          db.exec({
            sql: `SELECT DISTINCT namespace FROM logs WHERE namespace IS NOT NULL ORDER BY namespace`,
            rowMode: 'object',
            callback: (row) => namespaces.push((row as { namespace: string }).namespace),
          });
        }
        self.postMessage({ id, success: true, result: namespaces });
        break;
      }

      case 'clearAllLogs': {
        db.exec('DELETE FROM logs');
        db.exec("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')");
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
            callback: (row) => { count = (row as { count: number }).count; },
          });
        } else {
          db.exec({
            sql: 'SELECT COUNT(*) as count FROM logs WHERE encrypted = 1 OR decryption_failed = 1',
            rowMode: 'object',
            callback: (row) => { count = (row as { count: number }).count; },
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
            callback: (row) => rows.push(row as Record<string, unknown>),
          });
        } else {
          db.exec({
            sql: `SELECT * FROM logs WHERE (encrypted = 1 AND encrypted_data IS NOT NULL) OR (decryption_failed = 1 AND encrypted_data IS NOT NULL)`,
            rowMode: 'object',
            callback: (row) => rows.push(row as Record<string, unknown>),
          });
        }
        self.postMessage({ id, success: true, result: rows });
        break;
      }

      case 'getLevelCounts': {
        const options = payload as { channel?: string; minTime?: number };
        const conditions: string[] = [];
        const params: (string | number | null)[] = [];

        if (options?.channel) {
          conditions.push(`channel = ?`);
          params.push(options.channel);
        }

        // Apply time range filter so counts reflect the selected time window
        if (options?.minTime && options.minTime > 0) {
          conditions.push(`time >= ?`);
          params.push(options.minTime);
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
          callback: (row) => { counts.all = (row as { count: number }).count; },
        });

        // Get counts per level
        db.exec({
          sql: `SELECT level_label, COUNT(*) as count FROM logs ${where} GROUP BY level_label`,
          bind: params,
          rowMode: 'object',
          callback: (row) => {
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
        const conditions: string[] = ['namespace IS NOT NULL'];
        const params: (string | number | null)[] = [];

        if (options?.channel) {
          conditions.push(`channel = ?`);
          params.push(options.channel);
        }

        // Apply time range filter so counts reflect the selected time window
        if (options?.minTime && options.minTime > 0) {
          conditions.push(`time >= ?`);
          params.push(options.minTime);
        }

        const where = `WHERE ${conditions.join(' AND ')}`;
        const counts: Record<string, number> = {};

        // Get counts per namespace
        db.exec({
          sql: `SELECT namespace, COUNT(*) as count FROM logs ${where} GROUP BY namespace ORDER BY namespace`,
          bind: params,
          rowMode: 'object',
          callback: (row) => {
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
          callback: (row) => { stats.channelCount = (row as { count: number }).count; },
        });

        // Get total number of records
        db.exec({
          sql: 'SELECT COUNT(*) as count FROM logs',
          rowMode: 'object',
          callback: (row) => { stats.totalRecords = (row as { count: number }).count; },
        });

        // Get database size (page_count * page_size)
        db.exec({
          sql: 'SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()',
          rowMode: 'object',
          callback: (row) => { stats.databaseSize = (row as { size: number }).size; },
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
