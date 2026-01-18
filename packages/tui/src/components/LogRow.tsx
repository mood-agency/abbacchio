import React from 'react';
import { Box, Text } from 'ink';
import type { LogEntry } from '../types/index.js';
import { getLevelBadge, formatTime, formatNamespace, highlightSearch, truncate } from '../lib/colors.js';

interface LogRowProps {
  log: LogEntry;
  search?: string;
  maxWidth?: number;
  selected?: boolean;
}

export function LogRow({ log, search, maxWidth = 120, selected = false }: LogRowProps): React.ReactElement {
  const time = formatTime(log.time);
  const level = getLevelBadge(log.levelLabel);
  const namespace = formatNamespace(log.namespace);

  // Calculate available width for message
  const fixedWidth = 16; // time + level + spaces
  const nsWidth = log.namespace ? log.namespace.length + 2 : 0;
  const availableWidth = Math.max(20, maxWidth - fixedWidth - nsWidth);

  let message = log.msg || '';
  if (search) {
    message = highlightSearch(message, search);
  }

  // Format data payload
  const dataKeys = Object.keys(log.data);
  let dataStr = '';
  if (dataKeys.length > 0) {
    // Format as key=value pairs for readability
    dataStr = dataKeys.map(k => {
      const v = log.data[k];
      if (typeof v === 'string') {
        return `${k}="${v}"`;
      }
      return `${k}=${JSON.stringify(v)}`;
    }).join(' ');
  }

  // Combine message and data
  const fullContent = dataStr ? `${message} ${dataStr}` : message;
  const displayContent = truncate(fullContent, availableWidth);

  return (
    <Box flexDirection="row">
      {selected && <Text color="cyan">{'\u25B6'} </Text>}
      <Text>{time} </Text>
      <Text>{level} </Text>
      {namespace && <Text>{namespace} </Text>}
      <Text>{displayContent}</Text>
    </Box>
  );
}
