import React from 'react';
import { Box, Text } from 'ink';
import type { LogLevelNumber, LogLevelLabel } from '../types/index.js';
import { getLevelColor } from '../lib/colors.js';

interface StatusBarProps {
  levelFilter: LogLevelNumber | null;
  search: string;
}

const LEVEL_SHORTCUTS: Array<{ key: string; level: LogLevelNumber; label: LogLevelLabel }> = [
  { key: '1', level: 10, label: 'trace' },
  { key: '2', level: 20, label: 'debug' },
  { key: '3', level: 30, label: 'info' },
  { key: '4', level: 40, label: 'warn' },
  { key: '5', level: 50, label: 'error' },
  { key: '6', level: 60, label: 'fatal' },
];

export function StatusBar({ levelFilter, search }: StatusBarProps): React.ReactElement {
  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={1}>
        <Text dimColor>
          <Text bold>q</Text>:quit
        </Text>
        <Text dimColor>
          <Text bold>p</Text>:pause
        </Text>
        <Text dimColor>
          <Text bold>/</Text>:search
        </Text>
        <Text dimColor>
          <Text bold>?</Text>:help
        </Text>
        <Text dimColor>
          <Text bold>c</Text>:clear
        </Text>
      </Box>

      <Box gap={1}>
        <Text dimColor>Level: </Text>
        {LEVEL_SHORTCUTS.map(({ key, level, label }) => {
          const color = getLevelColor(label);
          const isActive = levelFilter === level;
          return (
            <Text key={key}>
              <Text dimColor={!isActive}>{key}:</Text>
              <Text {...(isActive ? { inverse: true } : { dimColor: true })}>
                {color(label.charAt(0).toUpperCase())}
              </Text>
            </Text>
          );
        })}
        <Text dimColor>
          0:<Text inverse={levelFilter === null}>All</Text>
        </Text>
      </Box>
    </Box>
  );
}
