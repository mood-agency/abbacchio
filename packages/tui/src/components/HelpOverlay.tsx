import React from 'react';
import { Box, Text } from 'ink';

interface HelpOverlayProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { category: 'Navigation', items: [
    { key: 'j / \u2193', desc: 'Scroll down' },
    { key: 'k / \u2191', desc: 'Scroll up' },
    { key: 'g', desc: 'Go to top' },
    { key: 'G', desc: 'Go to bottom' },
  ]},
  { category: 'Filtering', items: [
    { key: '/', desc: 'Search logs' },
    { key: '1-6', desc: 'Filter by level (trace-fatal)' },
    { key: '0', desc: 'Show all levels' },
    { key: 'Esc', desc: 'Clear filters' },
  ]},
  { category: 'Actions', items: [
    { key: 'p / Space', desc: 'Pause/Resume' },
    { key: 'c', desc: 'Clear logs' },
    { key: '?', desc: 'Toggle this help' },
    { key: 'q', desc: 'Quit' },
  ]},
];

export function HelpOverlay({ onClose }: HelpOverlayProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      padding={1}
      marginX={2}
      marginY={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">Keyboard Shortcuts</Text>
      </Box>

      {SHORTCUTS.map(({ category, items }) => (
        <Box key={category} flexDirection="column" marginBottom={1}>
          <Text bold underline>{category}</Text>
          {items.map(({ key, desc }) => (
            <Box key={key} gap={2}>
              <Box width={12}>
                <Text color="yellow">{key}</Text>
              </Box>
              <Text>{desc}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>Press any key to close</Text>
      </Box>
    </Box>
  );
}
