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
      decryption_failed INTEGER DEFAULT 0
    )
  `);

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
        }>;

        db.exec('BEGIN TRANSACTION');
        try {
          for (const log of logs) {
            db.exec({
              sql: `INSERT OR REPLACE INTO logs (id, level, level_label, time, msg, namespace, channel, data, encrypted, encrypted_data, decryption_failed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          level?: string;
          namespace?: string;
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

        if (options.level && options.level !== 'all') {
          conditions.push(`logs.level_label = ?`);
          params.push(options.level);
        }

        if (options.namespace) {
          conditions.push(`(logs.namespace LIKE ? OR logs.channel LIKE ?)`);
          const pattern = `%${options.namespace}%`;
          params.push(pattern, pattern);
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
          level?: string;
          namespace?: string;
          channel?: string;
        };

        const conditions: string[] = [];
        const params: (string | number | null)[] = [];

        // Filter by channel first (exact match)
        if (options.channel) {
          conditions.push(`logs.channel = ?`);
          params.push(options.channel);
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

        if (options.level && options.level !== 'all') {
          conditions.push(`logs.level_label = ?`);
          params.push(options.level);
        }

        if (options.namespace) {
          conditions.push(`(logs.namespace LIKE ? OR logs.channel LIKE ?)`);
          const pattern = `%${options.namespace}%`;
          params.push(pattern, pattern);
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
        const namespaces: string[] = [];
        db.exec({
          sql: `SELECT DISTINCT namespace FROM logs WHERE namespace IS NOT NULL ORDER BY namespace`,
          rowMode: 'object',
          callback: (row) => namespaces.push((row as { namespace: string }).namespace),
        });
        self.postMessage({ id, success: true, result: namespaces });
        break;
      }

      case 'clearAllLogs': {
        db.exec('DELETE FROM logs');
        db.exec("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')");
        self.postMessage({ id, success: true });
        break;
      }

      case 'hasEncryptedLogs': {
        let count = 0;
        db.exec({
          sql: 'SELECT COUNT(*) as count FROM logs WHERE encrypted = 1 OR decryption_failed = 1',
          rowMode: 'object',
          callback: (row) => { count = (row as { count: number }).count; },
        });
        self.postMessage({ id, success: true, result: count > 0 });
        break;
      }

      case 'getLogsNeedingDecryption': {
        const rows: Record<string, unknown>[] = [];
        db.exec({
          sql: `SELECT * FROM logs WHERE (encrypted = 1 AND encrypted_data IS NOT NULL) OR (decryption_failed = 1 AND encrypted_data IS NOT NULL)`,
          rowMode: 'object',
          callback: (row) => rows.push(row as Record<string, unknown>),
        });
        self.postMessage({ id, success: true, result: rows });
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    self.postMessage({ id, success: false, error: String(error) });
  }
};
