import { useState, useCallback, useEffect } from 'react';
import {
  getChannels,
  getChannel,
  upsertChannel,
  updateChannelKey,
  touchChannel,
  deleteChannel,
  type ChannelConfig,
} from '../lib/storage.js';

export type { ChannelConfig };

export interface UseChannelConfigResult {
  /** All saved channels */
  channels: ChannelConfig[];
  /** Current active channel */
  currentChannel: ChannelConfig | null;
  /** Set the active channel (creates if not exists) */
  setCurrentChannel: (name: string) => void;
  /** Update the key for a channel */
  updateKey: (name: string, key: string) => void;
  /** Get key for a channel */
  getKey: (name: string) => string;
  /** Delete a channel */
  removeChannel: (name: string) => void;
  /** Refresh channels list */
  refreshChannels: () => void;
  /** Whether the storage is initialized */
  isInitialized: boolean;
}

export function useChannelConfig(initialChannel?: string): UseChannelConfigResult {
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [currentChannel, setCurrentChannelState] = useState<ChannelConfig | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize and load channels
  useEffect(() => {
    const loadedChannels = getChannels();
    setChannels(loadedChannels);

    // Set initial channel if provided
    if (initialChannel) {
      let channel = getChannel(initialChannel);
      if (!channel) {
        channel = upsertChannel(initialChannel, '');
      } else {
        touchChannel(initialChannel);
      }
      setCurrentChannelState(channel);
      // Refresh channels list
      setChannels(getChannels());
    }

    setIsInitialized(true);
  }, [initialChannel]);

  // Refresh channels list from storage
  const refreshChannels = useCallback(() => {
    setChannels(getChannels());
  }, []);

  // Set the active channel
  const setCurrentChannel = useCallback((name: string) => {
    let channel = getChannel(name);
    if (!channel) {
      channel = upsertChannel(name, '');
    } else {
      touchChannel(name);
    }
    setCurrentChannelState(channel);
    refreshChannels();
  }, [refreshChannels]);

  // Update key for a channel
  const updateKey = useCallback((name: string, key: string) => {
    updateChannelKey(name, key);

    // Update current channel if it's the one being modified
    const updated = getChannel(name);
    if (currentChannel?.name === name && updated) {
      setCurrentChannelState(updated);
    }

    refreshChannels();
  }, [currentChannel, refreshChannels]);

  // Get key for a channel
  const getKey = useCallback((name: string): string => {
    const channel = getChannel(name);
    return channel?.secretKey || '';
  }, []);

  // Remove a channel
  const removeChannel = useCallback((name: string) => {
    deleteChannel(name);

    // If removing current channel, clear it
    if (currentChannel?.name === name) {
      setCurrentChannelState(null);
    }

    refreshChannels();
  }, [currentChannel, refreshChannels]);

  return {
    channels,
    currentChannel,
    setCurrentChannel,
    updateKey,
    getKey,
    removeChannel,
    refreshChannels,
    isInitialized,
  };
}
