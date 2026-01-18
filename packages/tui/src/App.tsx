import React, { useState, useCallback, useEffect } from 'react';
import { Box, useApp } from 'ink';
import type { CLIOptions } from './types/index.js';
import { useLogStore } from './hooks/useLogStore.js';
import { useCentrifugo } from './hooks/useCentrifugo.js';
import { useKeyBindings } from './hooks/useKeyBindings.js';
import { useChannelConfig } from './hooks/useChannelConfig.js';
import { Header } from './components/Header.js';
import { LogList } from './components/LogList.js';
import { FilterBar } from './components/FilterBar.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { ChannelSelector } from './components/ChannelSelector.js';

interface AppProps {
  options: CLIOptions;
}

export function App({ options }: AppProps): React.ReactElement {
  const { exit } = useApp();

  const [showHelp, setShowHelp] = useState(false);
  const [showChannelSelector, setShowChannelSelector] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);

  // Channel configuration with SQLite persistence
  const channelConfig = useChannelConfig(options.channel);

  // Current channel name
  const currentChannel = channelConfig.currentChannel?.name || options.channel;

  // Get encryption key: prefer stored key, fallback to CLI option
  const encryptionKey = channelConfig.getKey(currentChannel) || options.key;

  // If CLI provided a key and it's not stored, save it
  useEffect(() => {
    if (options.key && channelConfig.isInitialized && currentChannel) {
      const storedKey = channelConfig.getKey(currentChannel);
      if (!storedKey && options.key) {
        channelConfig.updateKey(currentChannel, options.key);
      }
    }
  }, [options.key, currentChannel, channelConfig.isInitialized]);

  const store = useLogStore(encryptionKey);

  const { status } = useCentrifugo({
    apiUrl: options.apiUrl,
    channel: currentChannel,
    onLog: store.addLog,
    onBatch: store.addLogs,
  });

  // Channel selector handlers
  const handleOpenChannelSelector = useCallback(() => {
    setShowChannelSelector(true);
  }, []);

  const handleChannelSelect = useCallback((channel: string, key: string) => {
    // Update channel config (stores key if changed)
    channelConfig.setCurrentChannel(channel);
    if (key !== channelConfig.getKey(channel)) {
      channelConfig.updateKey(channel, key);
    }

    setShowChannelSelector(false);
    store.clear(); // Clear logs when switching channels
    setScrollOffset(0);
  }, [channelConfig, store]);

  const handleChannelSelectorCancel = useCallback(() => {
    setShowChannelSelector(false);
  }, []);

  // Key bindings handlers
  const handleQuit = useCallback(() => {
    // Clear the screen before exiting
    process.stdout.write('\x1B[2J\x1B[0f');
    exit();
  }, [exit]);

  const handleTogglePause = useCallback(() => {
    store.togglePause();
    if (!store.paused) {
      setAutoScroll(true);
    }
  }, [store]);

  const handleToggleHelp = useCallback(() => {
    setShowHelp(h => !h);
  }, []);

  const handleScrollUp = useCallback(() => {
    setAutoScroll(false);
    setScrollOffset(o => Math.max(0, o - 1));
  }, []);

  const handleScrollDown = useCallback(() => {
    setScrollOffset(o => {
      const maxOffset = Math.max(0, store.filteredLogs.length - 10);
      if (o >= maxOffset - 1) {
        setAutoScroll(true);
      }
      return Math.min(maxOffset, o + 1);
    });
  }, [store.filteredLogs.length]);

  const handleScrollTop = useCallback(() => {
    setAutoScroll(false);
    setScrollOffset(0);
  }, []);

  const handleScrollBottom = useCallback(() => {
    setAutoScroll(true);
    setScrollOffset(Math.max(0, store.filteredLogs.length - 10));
  }, [store.filteredLogs.length]);

  const handleSearch = useCallback(() => {
    setIsSearching(true);
  }, []);

  const handleSearchSubmit = useCallback(() => {
    setIsSearching(false);
  }, []);

  const handleSearchCancel = useCallback(() => {
    setIsSearching(false);
  }, []);

  const handleClear = useCallback(() => {
    store.clear();
    setScrollOffset(0);
  }, [store]);

  useKeyBindings({
    onQuit: handleQuit,
    onTogglePause: handleTogglePause,
    onToggleHelp: handleToggleHelp,
    onScrollUp: handleScrollUp,
    onScrollDown: handleScrollDown,
    onScrollTop: handleScrollTop,
    onScrollBottom: handleScrollBottom,
    onSearch: handleSearch,
    onLevelFilter: store.setLevelFilter,
    onClear: handleClear,
    onChannelSelector: handleOpenChannelSelector,
    disabled: isSearching || showHelp || showChannelSelector,
  });

  if (showHelp) {
    return (
      <Box flexDirection="column">
        <Header
          channel={currentChannel}
          status={status}
          logCount={store.logs.length}
          filteredCount={store.filteredLogs.length}
          paused={store.paused}
        />
        <HelpOverlay onClose={handleToggleHelp} />
      </Box>
    );
  }

  if (showChannelSelector) {
    return (
      <Box flexDirection="column">
        <Header
          channel={currentChannel}
          status={status}
          logCount={store.logs.length}
          filteredCount={store.filteredLogs.length}
          paused={store.paused}
        />
        <ChannelSelector
          apiUrl={options.apiUrl}
          currentChannel={currentChannel}
          savedChannels={channelConfig.channels}
          onSelect={handleChannelSelect}
          onCancel={handleChannelSelectorCancel}
          getKey={channelConfig.getKey}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header
        channel={currentChannel}
        status={status}
        logCount={store.logs.length}
        filteredCount={store.filteredLogs.length}
        paused={store.paused}
      />

      <FilterBar
        levelFilter={store.filter.level}
        search={store.filter.search}
        onSearchChange={store.setSearch}
        isSearching={isSearching}
        onSearchSubmit={handleSearchSubmit}
        onSearchCancel={handleSearchCancel}
      />

      <LogList
        logs={store.filteredLogs}
        search={store.filter.search}
        scrollOffset={scrollOffset}
        onScrollChange={setScrollOffset}
        autoScroll={autoScroll && !store.paused}
      />

      <StatusBar
        levelFilter={store.filter.level}
        search={store.filter.search}
      />
    </Box>
  );
}
