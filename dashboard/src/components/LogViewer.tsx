import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLogStream } from '../hooks/useLogStream';
import { FilterBar } from './FilterBar';
import { LogRow } from './LogRow';
import type { FilterLevel } from '../types';

export function LogViewer() {
  const {
    logs,
    isConnected,
    isConnecting,
    clearLogs,
    connectionError,
    secretKey,
    setSecretKey,
    hasEncryptedLogs,
    channels,
    urlChannel,
  } = useLogStream();

  // Theme state
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  // Encryption key input
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInput, setKeyInput] = useState(secretKey);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);

  // Generate a new encryption key
  const generateKey = async () => {
    setIsGeneratingKey(true);
    try {
      const res = await fetch('/api/generate-key');
      const data = await res.json();
      if (data.key) {
        setKeyInput(data.key);
      }
    } catch (err) {
      console.error('Failed to generate key:', err);
    } finally {
      setIsGeneratingKey(false);
    }
  };

  // Copy key to clipboard
  const [copied, setCopied] = useState(false);
  const copyKey = async () => {
    if (!keyInput) return;
    try {
      await navigator.clipboard.writeText(keyInput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Copy full link with channel and key
  const [copiedLink, setCopiedLink] = useState(false);
  const copyLink = async () => {
    const params = new URLSearchParams();
    if (channelFilter) params.set('channel', channelFilter);
    if (keyInput) params.set('key', keyInput);
    const query = params.toString();
    const link = `${window.location.origin}${window.location.pathname}${query ? '?' + query : ''}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  // Filter state
  const [levelFilter, setLevelFilter] = useState<FilterLevel>('all');
  const channelFilter = urlChannel;
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-scroll state
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevLogCountRef = useRef(0);

  // Filter logs (already sorted newest first from the hook)
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Level filter
      if (levelFilter !== 'all' && log.levelLabel !== levelFilter) {
        return false;
      }

      // Channel filter
      if (channelFilter && !log.channel?.toLowerCase().includes(channelFilter.toLowerCase())) {
        return false;
      }

      // Namespace filter (also searches channel as fallback)
      if (namespaceFilter) {
        const filterLower = namespaceFilter.toLowerCase();
        const namespaceMatch = log.namespace?.toLowerCase().includes(filterLower);
        const channelMatch = log.channel?.toLowerCase().includes(filterLower);
        if (!namespaceMatch && !channelMatch) {
          return false;
        }
      }

      // Search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        const msgMatch = log.msg.toLowerCase().includes(searchLower);
        const namespaceMatch = log.namespace?.toLowerCase().includes(searchLower);
        const channelMatch = log.channel?.toLowerCase().includes(searchLower);
        const dataMatch = JSON.stringify(log.data).toLowerCase().includes(searchLower);
        if (!msgMatch && !namespaceMatch && !channelMatch && !dataMatch) {
          return false;
        }
      }

      return true;
    });
  }, [logs, levelFilter, channelFilter, namespaceFilter, searchQuery]);

  // Virtualization for performance with large log lists
  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36, // Estimated row height in pixels
    overscan: 20, // Render extra rows outside viewport for smoother scrolling
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  // Auto-scroll to top when new logs arrive (newest logs are at top)
  useEffect(() => {
    if (autoScroll && logs.length > prevLogCountRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    prevLogCountRef.current = logs.length;
  }, [logs.length, autoScroll]);

  // Detect user scroll
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop } = scrollContainerRef.current;
    const isAtTop = scrollTop < 50;
    setAutoScroll(isAtTop);
  }, []);

  const scrollToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
      setAutoScroll(true);
    }
  }, []);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-primary)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">pino-live</h1>
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected
                  ? 'bg-green-500'
                  : isConnecting
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-sm text-[var(--text-muted)]">
              {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
            </span>
          </div>

          {connectionError && (
            <span className="text-sm text-yellow-600 dark:text-yellow-400">{connectionError}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Encryption key indicator/input */}
          <div className="flex items-center gap-2">
            {showKeyInput ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setSecretKey(keyInput);
                  setShowKeyInput(false);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Encryption key..."
                  className="px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] w-40"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={generateKey}
                  disabled={isGeneratingKey}
                  className="px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                  title="Generate a new random key"
                >
                  {isGeneratingKey ? '...' : 'Generate'}
                </button>
                <button
                  type="button"
                  onClick={copyKey}
                  disabled={!keyInput}
                  className="px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                  title="Copy key to clipboard"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  disabled={!keyInput && !channelFilter}
                  className="px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                  title="Copy link with channel and key"
                >
                  {copiedLink ? 'Copied!' : 'Copy Link'}
                </button>
                <button
                  type="submit"
                  className="px-2 py-1 text-sm rounded bg-[var(--accent)] text-white"
                >
                  Set
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowKeyInput(false);
                    setKeyInput(secretKey);
                  }}
                  className="px-2 py-1 text-sm text-[var(--text-muted)]"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                onClick={() => setShowKeyInput(true)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
                  secretKey
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : hasEncryptedLogs
                    ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
                title={secretKey ? 'Encryption key set - click to change' : 'Set or generate encryption key'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                {secretKey ? 'Key set' : 'Key'}
              </button>
            )}
          </div>

          {/* Theme toggle */}
          <button
            onClick={() => {
              document.documentElement.classList.toggle('dark');
              setIsDark(!isDark);
            }}
            className="p-2 rounded-md hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
            title="Toggle dark mode"
          >
            {isDark ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Filter bar */}
      <FilterBar
        levelFilter={levelFilter}
        setLevelFilter={setLevelFilter}
        namespaceFilter={namespaceFilter}
        setNamespaceFilter={setNamespaceFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onClear={clearLogs}
        logCount={logs.length}
        filteredCount={filteredLogs.length}
      />

      {/* Column headers */}
      <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <span className="w-24 flex-shrink-0">Time</span>
        <span className="w-16 flex-shrink-0">Level</span>
        {channels.length > 1 && !channelFilter && (
          <span className="w-24 flex-shrink-0">Channel</span>
        )}
        <span className="w-28 flex-shrink-0">Namespace</span>
        <span className="w-48 flex-shrink-0">Message</span>
        <span className="flex-1">Data</span>
      </div>

      {/* Log list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
            <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-lg">No logs yet</p>
            <p className="text-sm mt-1">Logs will appear here in real-time</p>
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const log = filteredLogs[virtualItem.index];
              // Guard against stale virtualizer items during clear
              if (!log) return null;
              return (
                <div
                  key={log.id}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <LogRow
                    log={log}
                    showChannel={channels.length > 1 && !channelFilter}
                    searchQuery={searchQuery}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scroll to top indicator */}
      {!autoScroll && logs.length > 0 && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-4 right-4 flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-white rounded-full shadow-lg hover:opacity-90 transition-opacity"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
          New logs
        </button>
      )}
    </div>
  );
}
