//! Centrifugo WebSocket connection manager
//!
//! This module handles the WebSocket connection to Centrifugo server,
//! maintaining it in the background regardless of webview state.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Connection state shared across the application
pub struct ConnectionState {
    /// Sender to communicate with the WebSocket task
    command_tx: Mutex<Option<mpsc::Sender<CentrifugoCommand>>>,
    /// Current connection status
    status: RwLock<ConnectionStatus>,
    /// Subscribed channels (channel_id -> channel_name)
    subscriptions: RwLock<HashMap<String, String>>,
}

impl Default for ConnectionState {
    fn default() -> Self {
        Self {
            command_tx: Mutex::new(None),
            status: RwLock::new(ConnectionStatus::Disconnected),
            subscriptions: RwLock::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

/// Commands sent to the WebSocket task
#[derive(Debug)]
#[allow(dead_code)]
enum CentrifugoCommand {
    Connect { url: String, token: String },
    Subscribe { channel_id: String, channel_name: String },
    Unsubscribe { channel_id: String },
    Disconnect,
}

/// Events emitted to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum CentrifugoEvent {
    Connected,
    Disconnected { reason: String },
    Error { error: String },
    Subscribed { channel_id: String },
    SubscriptionError { channel_id: String, error: String },
    Publication { channel_id: String, data: serde_json::Value },
}

/// Centrifugo protocol messages
#[derive(Debug, Serialize, Deserialize)]
struct CentrifugoRequest {
    id: u32,
    #[serde(flatten)]
    method: CentrifugoMethod,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "lowercase")]
enum CentrifugoMethod {
    Connect { token: String },
    Subscribe { channel: String },
    Unsubscribe { channel: String },
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct CentrifugoResponse {
    id: Option<u32>,
    result: Option<serde_json::Value>,
    error: Option<CentrifugoError>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct CentrifugoError {
    code: u32,
    message: String,
}

#[derive(Debug, Deserialize)]
struct CentrifugoPush {
    channel: Option<String>,
    pub r#pub: Option<CentrifugoPublication>,
}

#[derive(Debug, Deserialize)]
struct CentrifugoPublication {
    data: serde_json::Value,
}

/// Start the connection manager background task
pub async fn start_connection_manager(app: AppHandle) {
    let state = Arc::new(ConnectionState::default());
    app.manage(state.clone());

    // The actual WebSocket handling happens when connect_centrifugo is called
    // This just initializes the state
}

/// Connect to Centrifugo server
#[tauri::command]
pub async fn connect_centrifugo(
    app: AppHandle,
    state: State<'_, Arc<ConnectionState>>,
    url: String,
    token: String,
) -> Result<(), String> {
    // Create command channel
    let (tx, mut rx) = mpsc::channel::<CentrifugoCommand>(32);

    // Store the sender
    {
        let mut cmd_tx = state.command_tx.lock().await;
        *cmd_tx = Some(tx.clone());
    }

    // Update status
    {
        let mut status = state.status.write().await;
        *status = ConnectionStatus::Connecting;
    }

    let state_clone = state.inner().clone();
    let app_clone = app.clone();

    // Spawn WebSocket task
    tauri::async_runtime::spawn(async move {
        run_websocket_loop(app_clone, state_clone, url, token, &mut rx).await;
    });

    Ok(())
}

async fn run_websocket_loop(
    app: AppHandle,
    state: Arc<ConnectionState>,
    url: String,
    token: String,
    rx: &mut mpsc::Receiver<CentrifugoCommand>,
) {
    // Connect to WebSocket
    let ws_stream = match connect_async(&url).await {
        Ok((stream, _)) => stream,
        Err(e) => {
            {
                let mut status = state.status.write().await;
                *status = ConnectionStatus::Error(e.to_string());
            }
            let _ = app.emit("centrifugo-event", CentrifugoEvent::Error {
                error: format!("Connection failed: {}", e),
            });
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();

    // Send connect request
    let connect_req = CentrifugoRequest {
        id: 1,
        method: CentrifugoMethod::Connect { token },
    };

    if let Err(e) = write
        .send(Message::Text(serde_json::to_string(&connect_req).unwrap().into()))
        .await
    {
        let _ = app.emit("centrifugo-event", CentrifugoEvent::Error {
            error: format!("Failed to send connect: {}", e),
        });
        return;
    }

    let mut request_id = 2u32;
    let mut pending_subscribes: HashMap<u32, (String, String)> = HashMap::new();
    let mut channel_to_id: HashMap<String, String> = HashMap::new();

    loop {
        tokio::select! {
            // Handle incoming WebSocket messages
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(response) = serde_json::from_str::<CentrifugoResponse>(&text) {
                            // Handle response
                            if let Some(id) = response.id {
                                if id == 1 {
                                    // Connect response
                                    if response.error.is_some() {
                                        let err = response.error.unwrap();
                                        {
                                            let mut status = state.status.write().await;
                                            *status = ConnectionStatus::Error(err.message.clone());
                                        }
                                        let _ = app.emit("centrifugo-event", CentrifugoEvent::Error {
                                            error: err.message,
                                        });
                                        return;
                                    }
                                    // Connected successfully
                                    {
                                        let mut status = state.status.write().await;
                                        *status = ConnectionStatus::Connected;
                                    }
                                    let _ = app.emit("centrifugo-event", CentrifugoEvent::Connected);
                                } else if let Some((channel_id, channel_name)) = pending_subscribes.remove(&id) {
                                    // Subscribe response
                                    if let Some(err) = response.error {
                                        let _ = app.emit("centrifugo-event", CentrifugoEvent::SubscriptionError {
                                            channel_id,
                                            error: err.message,
                                        });
                                    } else {
                                        channel_to_id.insert(format!("logs:{}", channel_name), channel_id.clone());
                                        {
                                            let mut subs = state.subscriptions.write().await;
                                            subs.insert(channel_id.clone(), channel_name);
                                        }
                                        let _ = app.emit("centrifugo-event", CentrifugoEvent::Subscribed { channel_id });
                                    }
                                }
                            }
                        } else if let Ok(push) = serde_json::from_str::<CentrifugoPush>(&text) {
                            // Handle push (publication)
                            if let (Some(channel), Some(publication)) = (push.channel, push.r#pub) {
                                if let Some(channel_id) = channel_to_id.get(&channel) {
                                    let _ = app.emit("centrifugo-event", CentrifugoEvent::Publication {
                                        channel_id: channel_id.clone(),
                                        data: publication.data,
                                    });
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        {
                            let mut status = state.status.write().await;
                            *status = ConnectionStatus::Disconnected;
                        }
                        let _ = app.emit("centrifugo-event", CentrifugoEvent::Disconnected {
                            reason: "Connection closed".to_string(),
                        });
                        return;
                    }
                    Some(Err(e)) => {
                        {
                            let mut status = state.status.write().await;
                            *status = ConnectionStatus::Error(e.to_string());
                        }
                        let _ = app.emit("centrifugo-event", CentrifugoEvent::Error {
                            error: e.to_string(),
                        });
                        return;
                    }
                    _ => {}
                }
            }

            // Handle commands from the app
            cmd = rx.recv() => {
                match cmd {
                    Some(CentrifugoCommand::Subscribe { channel_id, channel_name }) => {
                        let req = CentrifugoRequest {
                            id: request_id,
                            method: CentrifugoMethod::Subscribe {
                                channel: format!("logs:{}", channel_name),
                            },
                        };
                        pending_subscribes.insert(request_id, (channel_id, channel_name));
                        request_id += 1;
                        let _ = write.send(Message::Text(serde_json::to_string(&req).unwrap().into())).await;
                    }
                    Some(CentrifugoCommand::Unsubscribe { channel_id }) => {
                        let subs = state.subscriptions.read().await;
                        if let Some(channel_name) = subs.get(&channel_id) {
                            let req = CentrifugoRequest {
                                id: request_id,
                                method: CentrifugoMethod::Unsubscribe {
                                    channel: format!("logs:{}", channel_name),
                                },
                            };
                            request_id += 1;
                            let _ = write.send(Message::Text(serde_json::to_string(&req).unwrap().into())).await;
                            channel_to_id.remove(&format!("logs:{}", channel_name));
                        }
                        drop(subs);
                        let mut subs = state.subscriptions.write().await;
                        subs.remove(&channel_id);
                    }
                    Some(CentrifugoCommand::Disconnect) | None => {
                        let _ = write.close().await;
                        {
                            let mut status = state.status.write().await;
                            *status = ConnectionStatus::Disconnected;
                        }
                        let _ = app.emit("centrifugo-event", CentrifugoEvent::Disconnected {
                            reason: "User disconnected".to_string(),
                        });
                        return;
                    }
                    Some(CentrifugoCommand::Connect { .. }) => {
                        // Already connected, ignore
                    }
                }
            }
        }
    }
}

/// Subscribe to a channel
#[tauri::command]
pub async fn subscribe_channel(
    state: State<'_, Arc<ConnectionState>>,
    channel_id: String,
    channel_name: String,
) -> Result<(), String> {
    let tx = state.command_tx.lock().await;
    if let Some(tx) = tx.as_ref() {
        tx.send(CentrifugoCommand::Subscribe { channel_id, channel_name })
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Not connected".to_string())
    }
}

/// Unsubscribe from a channel
#[tauri::command]
pub async fn unsubscribe_channel(
    state: State<'_, Arc<ConnectionState>>,
    channel_id: String,
) -> Result<(), String> {
    let tx = state.command_tx.lock().await;
    if let Some(tx) = tx.as_ref() {
        tx.send(CentrifugoCommand::Unsubscribe { channel_id })
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Not connected".to_string())
    }
}

/// Disconnect from Centrifugo
#[tauri::command]
pub async fn disconnect_centrifugo(
    state: State<'_, Arc<ConnectionState>>,
) -> Result<(), String> {
    let tx = state.command_tx.lock().await;
    if let Some(tx) = tx.as_ref() {
        tx.send(CentrifugoCommand::Disconnect)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Get current connection status
#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, Arc<ConnectionState>>,
) -> Result<ConnectionStatus, String> {
    let status = state.status.read().await;
    Ok(status.clone())
}
