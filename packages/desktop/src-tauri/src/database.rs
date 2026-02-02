use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Database path: ~/.abbacchio/logs.db
/// This path is also used by the MCP server for log queries
pub fn get_database_path() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    let abbacchio_dir = home.join(".abbacchio");
    std::fs::create_dir_all(&abbacchio_dir).expect("Could not create .abbacchio directory");
    abbacchio_dir.join("logs.db")
}

/// Managed database state
pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, rusqlite::Error> {
        let path = get_database_path();
        let conn = Connection::open(&path)?;

        // Enable WAL mode for better concurrency (MCP can read while dashboard writes)
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA synchronous=NORMAL;")?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

// ============================================================================
// Types matching the TypeScript interface
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub level: i32,
    pub level_label: String,
    pub time: i64,
    pub msg: String,
    pub namespace: Option<String>,
    pub channel: String,
    pub data: serde_json::Value,
    #[serde(default)]
    pub encrypted: bool,
    pub encrypted_data: Option<String>,
    #[serde(default)]
    pub decryption_failed: bool,
    #[serde(default)]
    pub was_encrypted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryOptions {
    pub search: Option<String>,
    pub use_regex: Option<bool>,
    pub case_sensitive: Option<bool>,
    pub levels: Option<Vec<String>>,
    pub namespaces: Option<Vec<String>>,
    pub min_time: Option<i64>,
    pub channel: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CountFilterOptions {
    pub channel: Option<String>,
    pub min_time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LevelCounts {
    pub all: i64,
    pub trace: i64,
    pub debug: i64,
    pub info: i64,
    pub warn: i64,
    pub error: i64,
    pub fatal: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStats {
    pub channel_count: i64,
    pub total_records: i64,
    pub database_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindowQueryOptions {
    pub channel: String,
    pub center_time: i64,
    pub window_half_size: i64,
    pub search: Option<String>,
    pub use_regex: Option<bool>,
    pub case_sensitive: Option<bool>,
    pub levels: Option<Vec<String>>,
    pub namespaces: Option<Vec<String>>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyLogCount {
    pub hour: i64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogTimeRange {
    pub min_time: Option<i64>,
    pub max_time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GetHourlyLogCountsOptions {
    pub channel: String,
    pub min_time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GetLogIndexByTimeOptions {
    pub channel: String,
    pub target_time: i64,
    pub levels: Option<Vec<String>>,
    pub namespaces: Option<Vec<String>>,
    pub min_time: Option<i64>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchCountOptions {
    pub search: String,
    pub channel: Option<String>,
    pub min_time: Option<i64>,
    pub levels: Option<Vec<String>>,
    pub namespaces: Option<Vec<String>>,
    pub log_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PruneOptions {
    pub max_age_ms: Option<i64>,
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
pub fn init_database(db: State<Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute_batch(
        r#"
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
        );

        CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time DESC);
        CREATE INDEX IF NOT EXISTS idx_logs_channel_time ON logs(channel, time DESC);
        CREATE INDEX IF NOT EXISTS idx_logs_channel_level_time ON logs(channel, level_label, time DESC);

        CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
            msg, namespace, channel, data,
            content='logs', content_rowid='rowid'
        );

        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS logs_ai AFTER INSERT ON logs BEGIN
            INSERT INTO logs_fts(rowid, msg, namespace, channel, data)
            VALUES (NEW.rowid, NEW.msg, NEW.namespace, NEW.channel, NEW.data);
        END;

        CREATE TRIGGER IF NOT EXISTS logs_ad AFTER DELETE ON logs BEGIN
            INSERT INTO logs_fts(logs_fts, rowid, msg, namespace, channel, data)
            VALUES ('delete', OLD.rowid, OLD.msg, OLD.namespace, OLD.channel, OLD.data);
        END;

        CREATE TRIGGER IF NOT EXISTS logs_au AFTER UPDATE ON logs BEGIN
            INSERT INTO logs_fts(logs_fts, rowid, msg, namespace, channel, data)
            VALUES ('delete', OLD.rowid, OLD.msg, OLD.namespace, OLD.channel, OLD.data);
            INSERT INTO logs_fts(rowid, msg, namespace, channel, data)
            VALUES (NEW.rowid, NEW.msg, NEW.namespace, NEW.channel, NEW.data);
        END;
        "#,
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn insert_logs(db: State<Database>, logs: Vec<LogEntry>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute_batch("BEGIN TRANSACTION;")
        .map_err(|e| e.to_string())?;

    for log in logs {
        let data_str = serde_json::to_string(&log.data).map_err(|e| e.to_string())?;
        conn.execute(
            r#"
            INSERT OR REPLACE INTO logs
            (id, level, level_label, time, msg, namespace, channel, data, encrypted, encrypted_data, decryption_failed, was_encrypted)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                log.id,
                log.level,
                log.level_label,
                log.time,
                log.msg,
                log.namespace,
                log.channel,
                data_str,
                log.encrypted as i32,
                log.encrypted_data,
                log.decryption_failed as i32,
                log.was_encrypted as i32,
            ],
        ).map_err(|e| e.to_string())?;
    }

    conn.execute_batch("COMMIT;").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_all_logs(db: State<Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM logs", [])
        .map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_logs_for_channel(db: State<Database>, channel: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM logs WHERE channel = ?1", [&channel])
        .map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_log_entry(row: &rusqlite::Row) -> rusqlite::Result<LogEntry> {
    let data_str: String = row.get(7)?;
    let data: serde_json::Value =
        serde_json::from_str(&data_str).unwrap_or(serde_json::Value::Object(Default::default()));

    Ok(LogEntry {
        id: row.get(0)?,
        level: row.get(1)?,
        level_label: row.get(2)?,
        time: row.get(3)?,
        msg: row.get(4)?,
        namespace: row.get(5)?,
        channel: row.get(6)?,
        data,
        encrypted: row.get::<_, i32>(8)? == 1,
        encrypted_data: row.get(9)?,
        decryption_failed: row.get::<_, i32>(10)? == 1,
        was_encrypted: row.get::<_, i32>(11)? == 1,
    })
}

#[tauri::command]
pub fn query_logs(db: State<Database>, options: QueryOptions) -> Result<Vec<LogEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT id, level, level_label, time, msg, namespace, channel, data, encrypted, encrypted_data, decryption_failed, was_encrypted FROM logs WHERE 1=1"
    );
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(ref channel) = options.channel {
        sql.push_str(" AND channel = ?");
        params_vec.push(Box::new(channel.clone()));
    }

    if let Some(ref levels) = options.levels {
        if !levels.is_empty() {
            let placeholders: Vec<String> = levels.iter().map(|_| "?".to_string()).collect();
            sql.push_str(&format!(" AND level_label IN ({})", placeholders.join(",")));
            for level in levels {
                params_vec.push(Box::new(level.clone()));
            }
        }
    }

    if let Some(ref namespaces) = options.namespaces {
        if !namespaces.is_empty() {
            let placeholders: Vec<String> = namespaces.iter().map(|_| "?".to_string()).collect();
            sql.push_str(&format!(" AND namespace IN ({})", placeholders.join(",")));
            for ns in namespaces {
                params_vec.push(Box::new(ns.clone()));
            }
        }
    }

    if let Some(min_time) = options.min_time {
        sql.push_str(" AND time >= ?");
        params_vec.push(Box::new(min_time));
    }

    if let Some(ref search) = options.search {
        if !search.is_empty() {
            // Simple LIKE search for now
            sql.push_str(" AND (msg LIKE ? OR data LIKE ?)");
            let pattern = format!("%{}%", search);
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }

    sql.push_str(" ORDER BY time DESC");

    let limit = options.limit.unwrap_or(100);
    let offset = options.offset.unwrap_or(0);
    sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_refs.as_slice(), row_to_log_entry)
        .map_err(|e| e.to_string())?;

    let mut logs = Vec::new();
    for row in rows {
        logs.push(row.map_err(|e| e.to_string())?);
    }

    Ok(logs)
}

#[tauri::command]
pub fn query_logs_in_time_window(
    db: State<Database>,
    options: TimeWindowQueryOptions,
) -> Result<Vec<LogEntry>, String> {
    let start = options.center_time - options.window_half_size;
    let end = options.center_time + options.window_half_size;

    let query_options = QueryOptions {
        channel: Some(options.channel),
        levels: options.levels,
        namespaces: options.namespaces,
        search: options.search,
        use_regex: options.use_regex,
        case_sensitive: options.case_sensitive,
        min_time: Some(start),
        limit: options.limit,
        offset: None,
    };

    // Get logs in window, then filter by end time
    let logs = query_logs(db, query_options)?;
    Ok(logs.into_iter().filter(|l| l.time <= end).collect())
}

#[tauri::command]
pub fn get_filtered_count(db: State<Database>, options: QueryOptions) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from("SELECT COUNT(*) FROM logs WHERE 1=1");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(ref channel) = options.channel {
        sql.push_str(" AND channel = ?");
        params_vec.push(Box::new(channel.clone()));
    }

    if let Some(ref levels) = options.levels {
        if !levels.is_empty() {
            let placeholders: Vec<String> = levels.iter().map(|_| "?".to_string()).collect();
            sql.push_str(&format!(" AND level_label IN ({})", placeholders.join(",")));
            for level in levels {
                params_vec.push(Box::new(level.clone()));
            }
        }
    }

    if let Some(min_time) = options.min_time {
        sql.push_str(" AND time >= ?");
        params_vec.push(Box::new(min_time));
    }

    if let Some(ref search) = options.search {
        if !search.is_empty() {
            sql.push_str(" AND (msg LIKE ? OR data LIKE ?)");
            let pattern = format!("%{}%", search);
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let count: i64 = conn
        .query_row(&sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(count)
}

#[tauri::command]
pub fn get_log_count(db: State<Database>) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM logs", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn get_distinct_namespaces(
    db: State<Database>,
    channel: Option<String>,
) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = if channel.is_some() {
        "SELECT DISTINCT namespace FROM logs WHERE channel = ? AND namespace IS NOT NULL ORDER BY namespace"
    } else {
        "SELECT DISTINCT namespace FROM logs WHERE namespace IS NOT NULL ORDER BY namespace"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let rows = if let Some(ref ch) = channel {
        stmt.query_map([ch], |row| row.get(0))
    } else {
        stmt.query_map([], |row| row.get(0))
    }
    .map_err(|e| e.to_string())?;

    let mut namespaces = Vec::new();
    for row in rows {
        namespaces.push(row.map_err(|e| e.to_string())?);
    }

    Ok(namespaces)
}

#[tauri::command]
pub fn get_namespace_counts(
    db: State<Database>,
    options: Option<CountFilterOptions>,
) -> Result<HashMap<String, i64>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let opts = options.unwrap_or_default();

    let mut sql = String::from("SELECT namespace, COUNT(*) FROM logs WHERE namespace IS NOT NULL");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(ref channel) = opts.channel {
        sql.push_str(" AND channel = ?");
        params_vec.push(Box::new(channel.clone()));
    }

    if let Some(min_time) = opts.min_time {
        sql.push_str(" AND time >= ?");
        params_vec.push(Box::new(min_time));
    }

    sql.push_str(" GROUP BY namespace");

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut counts = HashMap::new();
    for row in rows {
        let (ns, count) = row.map_err(|e| e.to_string())?;
        counts.insert(ns, count);
    }

    Ok(counts)
}

#[tauri::command]
pub fn get_level_counts(
    db: State<Database>,
    options: Option<CountFilterOptions>,
) -> Result<LevelCounts, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let opts = options.unwrap_or_default();

    let mut sql = String::from("SELECT level_label, COUNT(*) FROM logs WHERE 1=1");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(ref channel) = opts.channel {
        sql.push_str(" AND channel = ?");
        params_vec.push(Box::new(channel.clone()));
    }

    if let Some(min_time) = opts.min_time {
        sql.push_str(" AND time >= ?");
        params_vec.push(Box::new(min_time));
    }

    sql.push_str(" GROUP BY level_label");

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut counts = LevelCounts::default();
    for row in rows {
        let (label, count) = row.map_err(|e| e.to_string())?;
        counts.all += count;
        match label.as_str() {
            "trace" => counts.trace = count,
            "debug" => counts.debug = count,
            "info" => counts.info = count,
            "warn" => counts.warn = count,
            "error" => counts.error = count,
            "fatal" => counts.fatal = count,
            _ => {}
        }
    }

    Ok(counts)
}

#[tauri::command]
pub fn get_database_stats(db: State<Database>) -> Result<DatabaseStats, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let channel_count: i64 = conn
        .query_row("SELECT COUNT(DISTINCT channel) FROM logs", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;

    let total_records: i64 = conn
        .query_row("SELECT COUNT(*) FROM logs", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    // Get page_count and page_size for database size
    let page_count: i64 = conn
        .query_row("PRAGMA page_count", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let page_size: i64 = conn
        .query_row("PRAGMA page_size", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(DatabaseStats {
        channel_count,
        total_records,
        database_size: page_count * page_size,
    })
}

#[tauri::command]
pub fn has_encrypted_logs(db: State<Database>, channel: Option<String>) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = if channel.is_some() {
        "SELECT 1 FROM logs WHERE channel = ? AND (encrypted = 1 OR was_encrypted = 1) LIMIT 1"
    } else {
        "SELECT 1 FROM logs WHERE encrypted = 1 OR was_encrypted = 1 LIMIT 1"
    };

    let result: Option<i32> = if let Some(ref ch) = channel {
        conn.query_row(sql, [ch], |row| row.get(0)).optional()
    } else {
        conn.query_row(sql, [], |row| row.get(0)).optional()
    }
    .map_err(|e| e.to_string())?;

    Ok(result.is_some())
}

#[tauri::command]
pub fn get_logs_needing_decryption(
    db: State<Database>,
    channel: Option<String>,
) -> Result<Vec<LogEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT id, level, level_label, time, msg, namespace, channel, data, encrypted, encrypted_data, decryption_failed, was_encrypted FROM logs WHERE (encrypted = 1 OR decryption_failed = 1)"
    );

    if channel.is_some() {
        sql.push_str(" AND channel = ?");
    }

    sql.push_str(" ORDER BY time DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows = if let Some(ref ch) = channel {
        stmt.query_map([ch], row_to_log_entry)
    } else {
        stmt.query_map([], row_to_log_entry)
    }
    .map_err(|e| e.to_string())?;

    let mut logs = Vec::new();
    for row in rows {
        logs.push(row.map_err(|e| e.to_string())?);
    }

    Ok(logs)
}

#[tauri::command]
pub fn get_hourly_log_counts(
    db: State<Database>,
    options: GetHourlyLogCountsOptions,
) -> Result<Vec<HourlyLogCount>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT (time / 3600000) * 3600000 as hour, COUNT(*) as count FROM logs WHERE channel = ?",
    );
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    params_vec.push(Box::new(options.channel.clone()));

    if let Some(min_time) = options.min_time {
        sql.push_str(" AND time >= ?");
        params_vec.push(Box::new(min_time));
    }

    sql.push_str(" GROUP BY hour ORDER BY hour");

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(HourlyLogCount {
                hour: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut counts = Vec::new();
    for row in rows {
        counts.push(row.map_err(|e| e.to_string())?);
    }

    Ok(counts)
}

#[tauri::command]
pub fn get_log_time_range(db: State<Database>, channel: String) -> Result<LogTimeRange, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let min_time: Option<i64> = conn
        .query_row(
            "SELECT MIN(time) FROM logs WHERE channel = ?",
            [&channel],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();

    let max_time: Option<i64> = conn
        .query_row(
            "SELECT MAX(time) FROM logs WHERE channel = ?",
            [&channel],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();

    Ok(LogTimeRange { min_time, max_time })
}

#[tauri::command]
pub fn get_log_index_by_time(
    db: State<Database>,
    options: GetLogIndexByTimeOptions,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from("SELECT COUNT(*) FROM logs WHERE channel = ? AND time > ?");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    params_vec.push(Box::new(options.channel.clone()));
    params_vec.push(Box::new(options.target_time));

    if let Some(ref levels) = options.levels {
        if !levels.is_empty() {
            let placeholders: Vec<String> = levels.iter().map(|_| "?".to_string()).collect();
            sql.push_str(&format!(" AND level_label IN ({})", placeholders.join(",")));
            for level in levels {
                params_vec.push(Box::new(level.clone()));
            }
        }
    }

    if let Some(min_time) = options.min_time {
        sql.push_str(" AND time >= ?");
        params_vec.push(Box::new(min_time));
    }

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let count: i64 = conn
        .query_row(&sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(count)
}

#[tauri::command]
pub fn get_search_match_count(
    db: State<Database>,
    options: SearchMatchCountOptions,
) -> Result<i64, String> {
    // For simplicity, count logs that match the search
    // Full match counting would require more complex logic
    let query_options = QueryOptions {
        search: Some(options.search),
        channel: options.channel,
        min_time: options.min_time,
        levels: options.levels,
        namespaces: options.namespaces,
        ..Default::default()
    };

    get_filtered_count(db, query_options)
}

#[tauri::command]
pub fn prune_old_logs(db: State<Database>, options: Option<PruneOptions>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let max_age_ms = options
        .and_then(|o| o.max_age_ms)
        .unwrap_or(7 * 24 * 60 * 60 * 1000); // 7 days default

    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64
        - max_age_ms;

    conn.execute("DELETE FROM logs WHERE time < ?", [cutoff])
        .map_err(|e| e.to_string())?;

    // Rebuild FTS index
    conn.execute("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')", [])
        .map_err(|e| e.to_string())?;

    Ok(())
}
