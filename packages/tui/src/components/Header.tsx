import React from 'react';
import { Box, Text } from 'ink';
import type { ConnectionStatus } from '../types/index.js';
import { statusColors } from '../lib/colors.js';

interface HeaderProps {
  channel: string;
  status: ConnectionStatus;
  logCount: number;
  filteredCount: number;
  paused: boolean;
}

export function Header({ channel, status, logCount, filteredCount, paused }: HeaderProps): React.ReactElement {
  const statusIndicator = statusColors[status];
  const statusText = status === 'connected' ? 'Live' : status;

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box>
        <Text bold color="cyan">Abbacchio</Text>
        <Text dimColor> | </Text>
        <Text>Channel: </Text>
        <Text bold color="yellow">{channel}</Text>
      </Box>

      <Box>
        {paused && (
          <>
            <Text backgroundColor="yellow" color="black" bold> PAUSED </Text>
            <Text> </Text>
          </>
        )}
        <Text dimColor>
          {filteredCount !== logCount
            ? `${filteredCount}/${logCount} logs`
            : `${logCount} logs`
          }
        </Text>
        <Text dimColor> | </Text>
        <Text>{statusIndicator} </Text>
        <Text dimColor>{statusText}</Text>
      </Box>
    </Box>
  );
}
