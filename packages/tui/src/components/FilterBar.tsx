import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { LogLevelNumber, LOG_LEVELS } from '../types/index.js';

interface FilterBarProps {
  levelFilter: LogLevelNumber | null;
  search: string;
  onSearchChange: (search: string) => void;
  isSearching: boolean;
  onSearchSubmit: () => void;
}

export function FilterBar({
  levelFilter,
  search,
  onSearchChange,
  isSearching,
  onSearchSubmit,
}: FilterBarProps): React.ReactElement {
  const levelLabel = levelFilter !== null
    ? (({ 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' } as const)[levelFilter as keyof typeof LOG_LEVELS] || 'ALL')
    : 'ALL';

  return (
    <Box flexDirection="row" paddingX={1} gap={2}>
      <Box>
        <Text dimColor>Level: </Text>
        <Text color="yellow">{levelLabel}+</Text>
      </Box>

      <Box flexGrow={1}>
        {isSearching ? (
          <Box>
            <Text color="cyan">/</Text>
            <TextInput
              value={search}
              onChange={onSearchChange}
              onSubmit={onSearchSubmit}
              placeholder="Search logs..."
            />
          </Box>
        ) : search ? (
          <Box>
            <Text dimColor>Search: </Text>
            <Text color="cyan">{search}</Text>
            <Text dimColor> (press / to edit, Esc to clear)</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
