use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Get the filesystem path to the application's SQLite database.
///
/// Ensures the directory `~/.abbacchio` exists (creating it if necessary) and returns the path
/// to the `logs.db` file inside that directory. This same path is used by the MCP server for
/// log queries.
///
/// # Examples
///
/// ```
/// let db_path = get_database_path();
/// assert!(db_path.ends_with("logs.db"));
/// ```
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
    /// Opens (or creates) the application's SQLite database and configures the connection for concurrent access.
    ///
    /// On success returns a Database containing a mutex-protected rusqlite connection configured with WAL journal mode
    /// and NORMAL synchronous mode; on failure returns the underlying rusqlite error.
    ///
    /// # Examples
    ///
    /// ```
    /// let db = Database::new().expect("failed to open database");
    /// ```
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

/// Initializes the logs database schema, indices, FTS5 virtual table, and triggers to keep the FTS index synchronized.
///
/// Creates the `logs` table if it does not exist, the required indices, the `logs_fts` FTS5 virtual table, and the AFTER INSERT/DELETE/UPDATE triggers that maintain the FTS index.
///
/// # Returns
///
/// `Ok(())` on success, `Err(String)` with an error message on failure.
///
/// # Examples
///
/// ```
/// // Invoked by the Tauri runtime with a managed `State<Database>`; example usage occurs via the frontend:
/// // app.invoke("init_database", /* Tauri supplies the `State<Database>` automatically */);
/// ```
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

/// Inserts or replaces a batch of log entries into the database within a single transaction.
///
/// Each `LogEntry` in `logs` is serialized and written to the `logs` table; the operation is atomic
/// — either all entries are committed or none are on error.
///
/// # Returns
///
/// `Ok(())` if all entries were successfully written, `Err(String)` with an error message otherwise.
///
/// # Examples
///
/// ```
/// // Given a `db: State<Database>` and a prepared `entry: LogEntry`:
/// // insert_logs(db, vec![entry]).expect("failed to insert logs");
/// ```
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

/// Deletes all log records from the database and rebuilds the full-text search index.
///
/// The function removes every row in the `logs` table and triggers an FTS5 index rebuild
/// by inserting the special `'rebuild'` command into the `logs_fts` virtual table.
///
/// # Returns
///
/// `Ok(())` on success, `Err(String)` with an error message on failure.
///
/// # Examples
///
/// ```no_run
/// // Called from a Tauri command handler with an application-managed Database state:
/// // clear_all_logs(db_state).unwrap();
/// ```
#[tauri::command]
pub fn clear_all_logs(db: State<Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM logs", [])
        .map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes all log records for the specified channel and triggers a full-text-search index rebuild.
///
/// Removes rows from the `logs` table where `channel` equals the provided value, then inserts a rebuild
/// token into the FTS table to refresh the search index.
///
/// # Errors
///
/// Returns an error string if acquiring the database lock or executing the SQL statements fails.
///
/// # Examples
///
/// ```
/// // Remove logs for channel "app"
/// clear_logs_for_channel(db_state, "app".into()).unwrap();
/// ```
#[tauri::command]
pub fn clear_logs_for_channel(db: State<Database>, channel: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM logs WHERE channel = ?1", [&channel])
        .map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Converts a database row into a LogEntry.
///
/// The function reads the expected columns from `row`, parses the `data` column as JSON (falling
/// back to an empty object on parse failure), and converts integer flag fields (stored as 0/1)
/// into booleans for `encrypted`, `decryption_failed`, and `was_encrypted`.
///
/// # Examples
///
/// ```
/// use rusqlite::{Connection, params};
/// use serde_json::json;
///
/// // create an in-memory DB and a minimal logs table matching expected column order
/// let conn = Connection::open_in_memory().unwrap();
/// conn.execute_batch(r#"
///     CREATE TABLE logs (
///         id INTEGER,
///         level INTEGER,
///         level_label TEXT,
///         time INTEGER,
///         msg TEXT,
///         namespace TEXT,
///         channel TEXT,
///         data TEXT,
///         encrypted INTEGER,
///         encrypted_data TEXT,
///         decryption_failed INTEGER,
///         was_encrypted INTEGER
///     );
/// "#).unwrap();
///
/// let data = json!({"k":"v"}).to_string();
/// conn.execute(
///     "INSERT INTO logs VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
///     params![1i64, 2i64, "INFO", 123i64, "msg", "ns", "chan", data, 0i32, Option::<String>::None, 0i32, 0i32],
/// ).unwrap();
///
/// let mut stmt = conn.prepare("SELECT * FROM logs").unwrap();
/// let entry = stmt.query_row([], |row| crate::row_to_log_entry(row)).unwrap();
/// assert_eq!(entry.id, 1);
/// assert_eq!(entry.level_label, "INFO");
/// assert_eq!(entry.data["k"], "v");
/// ```
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

/// Retrieves log entries matching the provided filters and pagination options.
///
/// Supports filtering by channel, levels, namespaces, minimum time, and a simple substring search against `msg` and `data`. Results are ordered by `time` descending and constrained by `limit` and `offset` in `QueryOptions`.
///
/// # Examples
///
/// ```
/// // Build query options (use default limit 100 if omitted)
/// let options = QueryOptions {
///     channel: Some("main".into()),
///     search: Some("error".into()),
///     ..Default::default()
/// };
///
/// // `db` is the application Database state provided by Tauri; in a command handler you can call:
/// // let logs = query_logs(db, options)?;
/// ```
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

/// Retrieves log entries whose timestamps fall within a time window centered at a specified time.
///
/// The returned entries satisfy: `time >= center_time - window_half_size` and `time <= center_time + window_half_size`.
/// The query applies any additional filters provided in `TimeWindowQueryOptions` (channel, levels, namespaces, search flags, and limit).
///
/// # Examples
///
/// ```no_run
/// use crate::database::{query_logs_in_time_window, TimeWindowQueryOptions};
/// // `db` is the application Database state passed by Tauri at runtime.
/// let opts = TimeWindowQueryOptions {
///     channel: "main".to_string(),
///     center_time: 1_700_000_000_000i64,
///     window_half_size: 60_000, // 1 minute before and after
///     search: None,
///     use_regex: None,
///     case_sensitive: None,
///     levels: None,
///     namespaces: None,
///     limit: Some(100),
/// };
/// // let results = query_logs_in_time_window(db, opts).unwrap();
/// ```
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

/// Count log records that match the provided filtering options.
///
/// The function applies these filters when computing the count: channel equality,
/// membership of `level_label` in `levels`, `time >= min_time`, and a substring
/// search against `msg` and `data`.
///
/// # Returns
///
/// `i64` containing the number of log rows that satisfy the filters.
///
/// # Examples
///
/// ```no_run
/// use std::collections::HashMap;
/// // Construct a QueryOptions to count logs for channel "app" with level "error"
/// let options = QueryOptions {
///     channel: Some("app".to_string()),
///     search: None,
///     use_regex: false,
///     case_sensitive: false,
///     levels: Some(vec!["error".to_string()]),
///     namespaces: None,
///     min_time: None,
///     channel: None,
///     limit: None,
///     offset: None,
/// };
/// // `db` would be provided by the application runtime (Tauri State<Database>).
/// // let count = get_filtered_count(db, options).unwrap();
/// ```
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

/// Get the total number of log records in the database.
///
/// # Returns
///
/// `i64` total number of rows in the `logs` table.
///
/// # Examples
///
/// ```
/// // assuming `db` is a `State<Database>` provided by the Tauri runtime
/// let total = get_log_count(db).unwrap();
/// assert!(total >= 0);
/// ```
#[tauri::command]
pub fn get_log_count(db: State<Database>) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM logs", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(count)
}

/// Retrieves the distinct non-null namespaces stored in the logs, optionally scoped to a specific channel.
///
/// If `channel` is `Some`, only namespaces from that channel are returned. Results are ordered by namespace.
///
/// # Examples
///
/// ```
/// // Example usage (pseudo-code; construct a `State<Database>` appropriately in real tests)
/// let namespaces = get_distinct_namespaces(db_state, Some("main".into())).unwrap();
/// assert!(namespaces.iter().all(|s| !s.is_empty()));
/// ```
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

/// Counts log records grouped by namespace, optionally filtered by channel and minimum time.
///
/// When `options` is provided, a `channel` filter limits results to that channel and a
/// `min_time` filter excludes logs older than the given timestamp (milliseconds since epoch).
///
/// # Returns
///
/// A `HashMap` mapping each namespace string to its corresponding record count.
///
/// # Examples
///
/// ```
/// # use std::collections::HashMap;
/// # use packages_desktop::database::{get_namespace_counts, CountFilterOptions, Database};
/// # // `db` would normally be provided by Tauri state; this example shows intended usage.
/// let opts = CountFilterOptions { channel: Some("main".into()), min_time: None };
/// // let counts: Result<HashMap<String, i64>, String> = get_namespace_counts(db, Some(opts));
/// ```
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

/// Aggregates log counts by level, optionally limited to a specific channel and/or a minimum timestamp.
///
/// The returned `LevelCounts` contains per-level totals (`trace`, `debug`, `info`, `warn`, `error`, `fatal`)
/// and `all` as the sum of all counted records.
///
/// # Parameters
///
/// - `options`: Optional `CountFilterOptions` to restrict the aggregation. When provided, `channel` limits
///   the query to that channel and `min_time` excludes records with `time` less than the given value.
///
/// # Returns
///
/// `LevelCounts` with counts for each log level and `all` equal to the total of those counts.
///
/// # Examples
///
/// ```
/// // Basic usage: no filters
/// let counts = get_level_counts(db_state, None).unwrap();
/// assert!(counts.all >= 0);
/// ```
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

/// Collects basic statistics about the logs database.
///
/// Returns a DatabaseStats struct containing the number of distinct channels,
/// the total number of log records, and the database size in bytes (page_count * page_size).
///
/// # Examples
///
/// ```
/// // Given a `db: tauri::State<Database>` in a command handler:
/// // let stats = get_database_stats(db).unwrap();
/// // assert!(stats.total_records >= 0);
/// ```
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

/// Checks whether the database contains any encrypted logs, optionally limited to a specific channel.
///
/// # Parameters
///
/// - `channel`: If provided, restricts the check to logs belonging to that channel.
///
/// # Returns
///
/// `true` if at least one log row has `encrypted = 1` or `was_encrypted = 1` (within the optional channel), `false` otherwise.
///
/// # Examples
///
/// ```no_run
/// // Assume `db` is a `State<Database>` provided by Tauri.
/// // Checks globally:
/// let has_any = has_encrypted_logs(db, None).unwrap();
///
/// // Checks only within "main" channel:
/// let has_in_main = has_encrypted_logs(db, Some("main".into())).unwrap();
/// ```
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

/// Fetches logs that are encrypted or whose decryption previously failed.
///
/// If `channel` is provided, only logs from that channel are returned. Results are ordered by `time` descending.
///
/// # Parameters
///
/// - `channel`: Optional channel name to restrict the query.
///
/// # Returns
///
/// `Vec<LogEntry>` of matching log entries where `encrypted` is `true` or `decryption_failed` is `true`, ordered by `time` descending.
///
/// # Examples
///
/// ```no_run
/// // Fetch all logs needing decryption
/// let logs = get_logs_needing_decryption(db, None).unwrap();
///
/// // Fetch logs needing decryption for a specific channel
/// let channel_logs = get_logs_needing_decryption(db, Some("main".into())).unwrap();
/// ```
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

/// Aggregates log records into hourly buckets for a specific channel.
///
/// Returns a vector of `HourlyLogCount` where each entry contains the hour (milliseconds since epoch
/// rounded down to the hour) and the number of log records in that hour for the provided channel.
/// If `options.min_time` is set, only logs with `time >= min_time` are considered.
///
/// # Examples
///
/// ```
/// // Construct options for channel "main" with no minimum time
/// let opts = GetHourlyLogCountsOptions { channel: "main".into(), min_time: None };
/// // `db` would be provided by Tauri in real usage; here we show the call shape:
/// // let counts = get_hourly_log_counts(db, opts).unwrap();
/// ```
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

/// Returns the earliest and latest log timestamps for the given channel.
///
/// The returned `LogTimeRange` contains `min_time` as the smallest (earliest) `time` value
/// and `max_time` as the largest (latest) `time` value found in the `logs` table for `channel`.
/// Each field is `None` when there are no logs for the specified channel.
///
/// # Examples
///
/// ```no_run
/// // `db` is the Tauri-managed `State<Database>` passed to command handlers.
/// let range = get_log_time_range(db, "main".to_string()).unwrap();
/// println!("min: {:?}, max: {:?}", range.min_time, range.max_time);
/// ```
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

/// Counts logs in a channel that occurred after a target time, optionally filtered by level labels and a minimum time.
///
/// The query counts rows in the `logs` table where `channel` equals `options.channel` and `time` is strictly greater than `options.target_time`.
/// If `options.levels` is provided and non-empty, only rows whose `level_label` is one of those values are included.
/// If `options.min_time` is provided, only rows with `time >= options.min_time` are included.
///
/// # Examples
///
/// ```
/// use packages::desktop::src_tauri::database::GetLogIndexByTimeOptions;
///
/// let opts = GetLogIndexByTimeOptions {
///     channel: "main".into(),
///     target_time: 1_700_000_000_000i64,
///     levels: Some(vec!["error".into(), "warn".into()]),
///     namespaces: None,
///     min_time: Some(1_699_000_000_000i64),
/// };
///
/// // `db` would be the application Database state provided by Tauri in real usage.
/// // let count = get_log_index_by_time(db, opts).unwrap();
/// ```
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

/// Counts log records that match a search query and optional filters.
///
/// This performs a filtered count using the provided search string and any other constraints
/// present on `options` (channel, time range, levels, namespaces).
///
/// # Returns
///
/// `i64` number of log records that match the query.
///
/// # Examples
///
/// ```no_run
/// use packages_desktop_src_tauri_src_database::{get_search_match_count, SearchMatchCountOptions};
/// // `db` would be provided by Tauri application state in real usage.
/// let options = SearchMatchCountOptions {
///     search: "error".to_string(),
///     channel: None,
///     min_time: None,
///     levels: None,
///     namespaces: None,
///     log_ids: None,
/// };
/// // let count = get_search_match_count(db, options).unwrap();
/// ```
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

/// Removes log records older than a specified age and rebuilds the full-text search index.
///
/// Deletes rows from the `logs` table whose `time` is less than the current time minus
/// the configured maximum age in milliseconds. After deletion, triggers a rebuild of the
/// FTS index (`logs_fts`) to keep search results consistent.
///
/// The `options.max_age_ms` value, if provided, sets the maximum age in milliseconds; otherwise
/// a default of 7 days (7 * 24 * 60 * 60 * 1000 ms) is used.
///
/// # Examples
///
/// ```no_run
/// use packages_desktop_src_tauri_src_database::{prune_old_logs, PruneOptions, Database};
/// use tauri::State;
///
/// // `db` would be the Tauri-managed `State<Database>` in real usage.
/// // This example demonstrates the call shape only.
/// let options = Some(PruneOptions { max_age_ms: Some(24 * 60 * 60 * 1000) }); // 1 day
/// // prune_old_logs(db, options).unwrap();
/// ```
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