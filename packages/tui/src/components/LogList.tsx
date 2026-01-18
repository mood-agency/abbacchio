import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  const [dimensions, setDimensions] = useState({
    width: stdout?.columns || 80,
    height: stdout?.rows || 24,
  });

  // Update dimensions on resize
  useEffect(() => {
    const handleResize = () => {
      if (stdout) {
        setDimensions({
          width: stdout.columns,
          height: stdout.rows,
        });
      }
    };

    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
    };
  }, [stdout]);

  // Calculate visible area (reserve space for header, filter bar, status bar)
  const visibleHeight = Math.max(1, dimensions.height - 5);
  const maxWidth = dimensions.width - 2;

  // Auto-scroll to bottom when new logs arrive
  const prevLogsLength = useRef(logs.length);
  useEffect(() => {
    if (autoScroll && logs.length > prevLogsLength.current) {
      const maxOffset = Math.max(0, logs.length - visibleHeight);
      onScrollChange(maxOffset);
    }
    prevLogsLength.current = logs.length;
  }, [logs.length, autoScroll, visibleHeight, onScrollChange]);

  // Get visible logs
  const startIndex = Math.max(0, Math.min(scrollOffset, logs.length - visibleHeight));
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
