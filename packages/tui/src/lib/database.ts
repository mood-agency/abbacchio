import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { LogEntry, LogLevelLabel } from '../types/index.js';

// Database path: ~/.abbacchio/tui.db
const DATA_DIR = join(homedir(), '.abbacchio');
const DB_PATH = join(DATA_DIR, 'tui.db');

let db: Database.Database | null = null;

/**
 * Channel configuration stored in database
 */
export interface ChannelConfig {
  id: number;
  name: string;
  secretKey: string;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * Initialize the database and create tables
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    -- Channels table for storing channel configurations
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      secret_key TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );

    -- Logs table for storing log entries
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      level INTEGER NOT NULL,
      level_label TEXT NOT NULL,
      time INTEGER NOT NULL,
      msg TEXT DEFAULT '',
      namespace TEXT,
      data TEXT DEFAULT '{}',
      encrypted INTEGER DEFAULT 0,
      encrypted_data TEXT,
      created_at INTEGER NOT NULL
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_logs_channel ON logs(channel);
    CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_channel_time ON logs(channel, time DESC);
  `);

  return db;
}

/**
 * Get database instance
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ============== Channel Operations ==============

/**
 * Get all channels
 */
export function getChannels(): ChannelConfig[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, name, secret_key, created_at, last_used_at
    FROM channels
    ORDER BY last_used_at DESC
  `).all() as Array<{
    id: number;
    name: string;
    secret_key: string;
    created_at: number;
    last_used_at: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    secretKey: row.secret_key,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

/**
 * Get a channel by name
 */
export function getChannel(name: string): ChannelConfig | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, name, secret_key, created_at, last_used_at
    FROM channels
    WHERE name = ?
  `).get(name) as {
    id: number;
    name: string;
    secret_key: string;
    created_at: number;
    last_used_at: number;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    secretKey: row.secret_key,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Add or update a channel
 */
export function upsertChannel(name: string, secretKey: string = ''): ChannelConfig {
  const db = getDatabase();
  const now = Date.now();

  db.prepare(`
    INSERT INTO channels (name, secret_key, created_at, last_used_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      secret_key = excluded.secret_key,
      last_used_at = excluded.last_used_at
  `).run(name, secretKey, now, now);

  return getChannel(name)!;
}

/**
 * Update channel's secret key
 */
export function updateChannelKey(name: string, secretKey: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE channels SET secret_key = ?, last_used_at = ?
    WHERE name = ?
  `).run(secretKey, Date.now(), name);
}

/**
 * Update channel's last used timestamp
 */
export function touchChannel(name: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE channels SET last_used_at = ?
    WHERE name = ?
  `).run(Date.now(), name);
}

/**
 * Delete a channel and its logs
 */
export function deleteChannel(name: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM logs WHERE channel = ?').run(name);
  db.prepare('DELETE FROM channels WHERE name = ?').run(name);
}

// ============== Log Operations ==============

/**
 * Insert a single log entry
 */
export function insertLog(log: LogEntry): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO logs (id, channel, level, level_label, time, msg, namespace, data, encrypted, encrypted_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.id,
    log.channel,
    log.level,
    log.levelLabel,
    log.time,
    log.msg || '',
    log.namespace || null,
    JSON.stringify(log.data || {}),
    log.encrypted ? 1 : 0,
    log.encryptedData || null,
    Date.now()
  );
}

/**
 * Insert multiple log entries (batched)
 */
export function insertLogs(logs: LogEntry[]): void {
  if (logs.length === 0) return;

  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO logs (id, channel, level, level_label, time, msg, namespace, data, encrypted, encrypted_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((logs: LogEntry[]) => {
    const now = Date.now();
    for (const log of logs) {
      stmt.run(
        log.id,
        log.channel,
        log.level,
        log.levelLabel,
        log.time,
        log.msg || '',
        log.namespace || null,
        JSON.stringify(log.data || {}),
        log.encrypted ? 1 : 0,
        log.encryptedData || null,
        now
      );
    }
  });

  insertMany(logs);
}

/**
 * Query logs with filters
 */
export interface QueryLogsOptions {
  channel: string;
  limit?: number;
  offset?: number;
  minLevel?: number;
  search?: string;
  minTime?: number;
}

export function queryLogs(options: QueryLogsOptions): LogEntry[] {
  const db = getDatabase();
  const { channel, limit = 100, offset = 0, minLevel, search, minTime } = options;

  let sql = 'SELECT * FROM logs WHERE channel = ?';
  const params: (string | number)[] = [channel];

  if (minLevel !== undefined) {
    sql += ' AND level >= ?';
    params.push(minLevel);
  }

  if (search) {
    sql += ' AND (msg LIKE ? OR namespace LIKE ? OR data LIKE ?)';
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  if (minTime !== undefined) {
    sql += ' AND time >= ?';
    params.push(minTime);
  }

  sql += ' ORDER BY time DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    channel: string;
    level: number;
    level_label: string;
    time: number;
    msg: string;
    namespace: string | null;
    data: string;
    encrypted: number;
    encrypted_data: string | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    channel: row.channel,
    level: row.level,
    levelLabel: row.level_label as LogLevelLabel,
    time: row.time,
    msg: row.msg,
    namespace: row.namespace || undefined,
    data: JSON.parse(row.data || '{}'),
    encrypted: row.encrypted === 1,
    encryptedData: row.encrypted_data || undefined,
  }));
}

/**
 * Get log count for a channel
 */
export function getLogCount(channel: string): number {
  const db = getDatabase();
  const row = db.prepare('SELECT COUNT(*) as count FROM logs WHERE channel = ?').get(channel) as { count: number };
  return row.count;
}

/**
 * Clear logs for a channel
 */
export function clearLogs(channel: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM logs WHERE channel = ?').run(channel);
}

/**
 * Clear all logs
 */
export function clearAllLogs(): void {
  const db = getDatabase();
  db.prepare('DELETE FROM logs').run();
}

/**
 * Get logs that need decryption (have encrypted_data but encrypted=1)
 */
export function getLogsNeedingDecryption(channel: string): LogEntry[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM logs
    WHERE channel = ? AND encrypted = 1 AND encrypted_data IS NOT NULL
    ORDER BY time DESC
  `).all(channel) as Array<{
    id: string;
    channel: string;
    level: number;
    level_label: string;
    time: number;
    msg: string;
    namespace: string | null;
    data: string;
    encrypted: number;
    encrypted_data: string | null;
  }>;

  return rows.map(row => ({
    id: row.id,
    channel: row.channel,
    level: row.level,
    levelLabel: row.level_label as LogLevelLabel,
    time: row.time,
    msg: row.msg,
    namespace: row.namespace || undefined,
    data: JSON.parse(row.data || '{}'),
    encrypted: true,
    encryptedData: row.encrypted_data || undefined,
  }));
}

/**
 * Update a log entry (for re-decryption)
 */
export function updateLog(log: LogEntry): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE logs SET
      level = ?,
      level_label = ?,
      time = ?,
      msg = ?,
      namespace = ?,
      data = ?,
      encrypted = ?
    WHERE id = ?
  `).run(
    log.level,
    log.levelLabel,
    log.time,
    log.msg || '',
    log.namespace || null,
    JSON.stringify(log.data || {}),
    log.encrypted ? 1 : 0,
    log.id
  );
}

/**
 * Update multiple logs (batched)
 */
export function updateLogs(logs: LogEntry[]): void {
  if (logs.length === 0) return;

  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE logs SET
      level = ?,
      level_label = ?,
      time = ?,
      msg = ?,
      namespace = ?,
      data = ?,
      encrypted = ?
    WHERE id = ?
  `);

  const updateMany = db.transaction((logs: LogEntry[]) => {
    for (const log of logs) {
      stmt.run(
        log.level,
        log.levelLabel,
        log.time,
        log.msg || '',
        log.namespace || null,
        JSON.stringify(log.data || {}),
        log.encrypted ? 1 : 0,
        log.id
      );
    }
  });

  updateMany(logs);
}
