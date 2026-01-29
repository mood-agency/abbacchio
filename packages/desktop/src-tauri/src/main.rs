// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod centrifugo;
mod database;

use database::Database;

/// Application entry point that initializes the database, starts the Tauri application,
/// registers plugins and command handlers, and spawns the Centrifugo connection manager
/// in the background.
///
/// The function constructs and runs the Tauri runtime, manages a shared `Database` instance,
/// wires centrifugo- and database-related commands for frontend invocation, and launches
/// an asynchronous task to maintain Centrifugo connections.
///
/// # Examples
///
/// ```no_run
/// // Start the application (runs the Tauri event loop)
/// crate::main();
/// ```
fn main() {
    // Initialize database
    let db = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(db)
        .setup(|app| {
            let handle = app.handle().clone();

            // Start Centrifugo connection manager in background
            tauri::async_runtime::spawn(async move {
                centrifugo::start_connection_manager(handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Centrifugo commands
            centrifugo::connect_centrifugo,
            centrifugo::subscribe_channel,
            centrifugo::unsubscribe_channel,
            centrifugo::disconnect_centrifugo,
            centrifugo::get_connection_status,
            // Database commands
            database::init_database,
            database::insert_logs,
            database::clear_all_logs,
            database::clear_logs_for_channel,
            database::query_logs,
            database::query_logs_in_time_window,
            database::get_filtered_count,
            database::get_log_count,
            database::get_distinct_namespaces,
            database::get_namespace_counts,
            database::get_level_counts,
            database::get_database_stats,
            database::has_encrypted_logs,
            database::get_logs_needing_decryption,
            database::get_hourly_log_counts,
            database::get_log_time_range,
            database::get_log_index_by_time,
            database::get_search_match_count,
            database::prune_old_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}