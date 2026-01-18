// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod centrifugo;


fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Start Centrifugo connection manager in background
            tauri::async_runtime::spawn(async move {
                centrifugo::start_connection_manager(handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            centrifugo::connect_centrifugo,
            centrifugo::subscribe_channel,
            centrifugo::unsubscribe_channel,
            centrifugo::disconnect_centrifugo,
            centrifugo::get_connection_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
