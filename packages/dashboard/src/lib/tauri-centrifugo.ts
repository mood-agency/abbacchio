/**
 * Tauri Centrifugo adapter
 *
 * This module provides a bridge between the frontend and the Rust backend
 * for Centrifugo WebSocket connections when running in Tauri.
 */

// Check if we're running in Tauri
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

// Types matching the Rust backend
export interface CentrifugoEvent {
  type: 'connected' | 'disconnected' | 'error' | 'subscribed' | 'subscription-error' | 'publication';
  reason?: string;
  error?: string;
  channel_id?: string;
  data?: unknown;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | { error: string };

// Lazy import Tauri API to avoid errors when not in Tauri
let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
let tauriListen: ((event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>) | null = null;

async function loadTauriApi() {
  if (!isTauri()) return false;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');
    tauriInvoke = invoke;
    tauriListen = listen;
    return true;
  } catch {
    console.warn('Failed to load Tauri API');
    return false;
  }
}

/**
 * Connect to Centrifugo via Tauri backend
 */
export async function connectCentrifugo(url: string, token: string): Promise<void> {
  if (!tauriInvoke) {
    await loadTauriApi();
  }
  if (!tauriInvoke) {
    throw new Error('Tauri API not available');
  }

  await tauriInvoke('connect_centrifugo', { url, token });
}

/**
 * Subscribe to a channel via Tauri backend
 */
export async function subscribeChannel(channelId: string, channelName: string): Promise<void> {
  if (!tauriInvoke) {
    throw new Error('Tauri API not available');
  }

  await tauriInvoke('subscribe_channel', { channelId, channelName });
}

/**
 * Unsubscribe from a channel via Tauri backend
 */
export async function unsubscribeChannel(channelId: string): Promise<void> {
  if (!tauriInvoke) {
    throw new Error('Tauri API not available');
  }

  await tauriInvoke('unsubscribe_channel', { channelId });
}

/**
 * Disconnect from Centrifugo via Tauri backend
 */
export async function disconnectCentrifugo(): Promise<void> {
  if (!tauriInvoke) {
    throw new Error('Tauri API not available');
  }

  await tauriInvoke('disconnect_centrifugo');
}

/**
 * Get current connection status
 */
export async function getConnectionStatus(): Promise<ConnectionStatus> {
  if (!tauriInvoke) {
    throw new Error('Tauri API not available');
  }

  return await tauriInvoke('get_connection_status') as ConnectionStatus;
}

/**
 * Listen to Centrifugo events from Tauri backend
 */
export async function listenCentrifugoEvents(
  handler: (event: CentrifugoEvent) => void
): Promise<() => void> {
  if (!tauriListen) {
    await loadTauriApi();
  }
  if (!tauriListen) {
    throw new Error('Tauri API not available');
  }

  return await tauriListen('centrifugo-event', (event) => {
    handler(event.payload as CentrifugoEvent);
  });
}

// Initialize Tauri API on module load if in Tauri environment
if (isTauri()) {
  loadTauriApi();
}
