/**
 * Tauri Centrifugo Hook
 *
 * This hook manages the Centrifugo connection when running in Tauri.
 * It replaces the Web Worker approach with direct Rust backend communication.
 */

import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  isTauri,
  connectCentrifugo,
  subscribeChannel,
  unsubscribeChannel,
  disconnectCentrifugo,
  listenCentrifugoEvents,
  type CentrifugoEvent,
} from '../lib/tauri-centrifugo';

interface UseTauriCentrifugoOptions {
  /** Callback when connection status changes */
  onConnectionChange?: (connected: boolean, error?: string) => void;
  /** Callback when a channel is subscribed */
  onSubscribed?: (channelId: string) => void;
  /** Callback when a publication is received */
  onPublication?: (channelId: string, data: unknown) => void;
  /** Get Centrifugo URL */
  getCentrifugoUrl: () => string;
  /** Fetch token for authentication */
  fetchToken: () => Promise<string>;
}

interface UseTauriCentrifugoResult {
  /** Whether we're running in Tauri */
  isTauriEnvironment: boolean;
  /** Connect to Centrifugo (Tauri only) */
  connect: () => Promise<void>;
  /** Subscribe to a channel (Tauri only) */
  subscribe: (channelId: string, channelName: string) => Promise<void>;
  /** Unsubscribe from a channel (Tauri only) */
  unsubscribe: (channelId: string) => Promise<void>;
  /** Disconnect (Tauri only) */
  disconnect: () => Promise<void>;
}

export function useTauriCentrifugo(options: UseTauriCentrifugoOptions): UseTauriCentrifugoResult {
  const { onConnectionChange, onSubscribed, onPublication, getCentrifugoUrl, fetchToken } = options;

  const isTauriEnv = isTauri();
  const unlistenRef = useRef<(() => void) | null>(null);
  const isConnectedRef = useRef(false);

  // Handle Centrifugo events from Tauri backend
  const handleEvent = useCallback((event: CentrifugoEvent) => {
    switch (event.type) {
      case 'connected':
        isConnectedRef.current = true;
        onConnectionChange?.(true);
        break;

      case 'disconnected':
        isConnectedRef.current = false;
        onConnectionChange?.(false, event.reason);
        break;

      case 'error':
        toast.error(`Connection error: ${event.error}`);
        onConnectionChange?.(false, event.error);
        break;

      case 'subscribed':
        if (event.channel_id) {
          onSubscribed?.(event.channel_id);
        }
        break;

      case 'subscription-error':
        toast.error(`Subscription error: ${event.error}`);
        break;

      case 'publication':
        if (event.channel_id && event.data) {
          onPublication?.(event.channel_id, event.data);
        }
        break;
    }
  }, [onConnectionChange, onSubscribed, onPublication]);

  // Set up event listener when in Tauri
  useEffect(() => {
    if (!isTauriEnv) return;

    let mounted = true;

    const setupListener = async () => {
      try {
        const unlisten = await listenCentrifugoEvents(handleEvent);
        if (mounted) {
          unlistenRef.current = unlisten;
        } else {
          unlisten();
        }
      } catch (error) {
        console.error('Failed to set up Tauri event listener:', error);
      }
    };

    setupListener();

    return () => {
      mounted = false;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [isTauriEnv, handleEvent]);

  // Connect to Centrifugo via Tauri
  const connect = useCallback(async () => {
    if (!isTauriEnv) return;

    try {
      const token = await fetchToken();
      const url = getCentrifugoUrl();
      await connectCentrifugo(url, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      toast.error(message);
      onConnectionChange?.(false, message);
    }
  }, [isTauriEnv, fetchToken, getCentrifugoUrl, onConnectionChange]);

  // Subscribe to a channel via Tauri
  const subscribe = useCallback(async (channelId: string, channelName: string) => {
    if (!isTauriEnv) return;

    try {
      await subscribeChannel(channelId, channelName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Subscribe failed';
      toast.error(message);
    }
  }, [isTauriEnv]);

  // Unsubscribe from a channel via Tauri
  const unsubscribe = useCallback(async (channelId: string) => {
    if (!isTauriEnv) return;

    try {
      await unsubscribeChannel(channelId);
    } catch (error) {
      console.error('Unsubscribe failed:', error);
    }
  }, [isTauriEnv]);

  // Disconnect via Tauri
  const disconnect = useCallback(async () => {
    if (!isTauriEnv) return;

    try {
      await disconnectCentrifugo();
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  }, [isTauriEnv]);

  return {
    isTauriEnvironment: isTauriEnv,
    connect,
    subscribe,
    unsubscribe,
    disconnect,
  };
}
