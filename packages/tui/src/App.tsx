import React, { useState, useCallback } from 'react';
import { Box, useApp } from 'ink';
import type { CLIOptions } from './types/index.js';
import { useLogStore } from './hooks/useLogStore.js';
import { useSSE } from './hooks/useSSE.js';
import { useKeyBindings } from './hooks/useKeyBindings.js';
import { Header } from './components/Header.js';
import { LogList } from './components/LogList.js';
import { FilterBar } from './components/FilterBar.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';

interface AppProps {
  options: CLIOptions;
}

export function App({ options }: AppProps): React.ReactElement {
  const { exit } = useApp();

  const [showHelp, setShowHelp] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);

  const store = useLogStore(options.key);

  const { status, error } = useSSE({
    apiUrl: options.apiUrl,
    channel: options.channel,
    onLog: store.addLog,
    onBatch: store.addLogs,
  });

  // Key bindings handlers
  const handleQuit = useCallback(() => {
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
    disabled: isSearching || showHelp,
  });

  if (showHelp) {
    return (
      <Box flexDirection="column">
        <Header
          channel={options.channel}
          status={status}
          logCount={store.logs.length}
          filteredCount={store.filteredLogs.length}
          paused={store.paused}
        />
        <HelpOverlay onClose={handleToggleHelp} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header
        channel={options.channel}
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
