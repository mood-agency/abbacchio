import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { LogEntry } from '../types/index.js';
import { LogRow } from './LogRow.js';

interface LogListProps {
  logs: LogEntry[];
  search?: string;
  scrollOffset: number;
  onScrollChange: (offset: number) => void;
  autoScroll: boolean;
}

export function LogList({ logs, search, scrollOffset, onScrollChange, autoScroll }: LogListProps): React.ReactElement {
  const { stdout } = useStdout();

  // Store dimensions in ref to avoid re-renders on resize
  const dimensionsRef = useRef({
    width: stdout?.columns || 80,
    height: stdout?.rows || 24,
  });
  const [, forceUpdate] = useState(0);

  // Update dimensions on resize (debounced)
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | null = null;

    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (stdout) {
          dimensionsRef.current = {
            width: stdout.columns,
            height: stdout.rows,
          };
          forceUpdate(n => n + 1);
        }
      }, 100);
    };

    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, [stdout]);

  // Calculate visible area (reserve space for header, filter bar, status bar)
  // Header: 3 lines (border + content + border)
  // FilterBar: 1 line
  // StatusBar: 3 lines (border + content + border)
  // Total: 7 lines
  const visibleHeight = Math.max(1, dimensionsRef.current.height - 7);
  const maxWidth = dimensionsRef.current.width - 2;

  // Store onScrollChange in ref to avoid dependency issues
  const onScrollChangeRef = useRef(onScrollChange);
  onScrollChangeRef.current = onScrollChange;

  // Auto-scroll to bottom when new logs arrive
  const prevLogsLength = useRef(logs.length);
  useEffect(() => {
    if (autoScroll && logs.length > prevLogsLength.current) {
      const maxOffset = Math.max(0, logs.length - visibleHeight);
      onScrollChangeRef.current(maxOffset);
    }
    prevLogsLength.current = logs.length;
  }, [logs.length, autoScroll, visibleHeight]);

  // Get visible logs
  const startIndex = Math.max(0, Math.min(scrollOffset, Math.max(0, logs.length - visibleHeight)));
  const endIndex = Math.min(startIndex + visibleHeight, logs.length);
  const visibleLogs = logs.slice(startIndex, endIndex);

  if (logs.length === 0) {
    return (
      <Box flexDirection="column" height={visibleHeight} justifyContent="center" alignItems="center">
        <Text dimColor>Waiting for logs...</Text>
        <Text dimColor>Send logs to this channel to see them here</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={visibleHeight}>
      {visibleLogs.map((log, index) => (
        <LogRow
          key={log.id}
          log={log}
          search={search}
          maxWidth={maxWidth}
        />
      ))}
      {/* Fill remaining space */}
      {Array.from({ length: Math.max(0, visibleHeight - visibleLogs.length) }).map((_, i) => (
        <Box key={`empty-${i}`} height={1} />
      ))}
    </Box>
  );
}
