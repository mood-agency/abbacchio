import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import type { ChannelConfig } from '../lib/database.js';

interface ChannelSelectorProps {
  apiUrl: string;
  currentChannel: string;
  savedChannels: ChannelConfig[];
  onSelect: (channel: string, key: string) => void;
  onCancel: () => void;
  getKey: (name: string) => string;
}

interface SelectItem {
  label: string;
  value: string;
}

type Step = 'select' | 'new-channel' | 'edit-key';

const NEW_CHANNEL_VALUE = '__new__';

export function ChannelSelector({
  apiUrl,
  currentChannel,
  savedChannels,
  onSelect,
  onCancel,
  getKey,
}: ChannelSelectorProps): React.ReactElement {
  const [apiChannels, setApiChannels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('select');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [keyValue, setKeyValue] = useState('');

  // Fetch available channels from API
  useEffect(() => {
    const fetchChannels = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/channels`);
        if (!response.ok) {
          throw new Error(`Failed to fetch channels: ${response.status}`);
        }
        const data = await response.json() as { channels: string[] };
        setApiChannels(data.channels || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch channels');
      } finally {
        setIsLoading(false);
      }
    };

    fetchChannels();
  }, [apiUrl]);

  // Handle escape to cancel/go back
  useInput((input, key) => {
    if (key.escape) {
      if (step === 'new-channel' || step === 'edit-key') {
        setStep('select');
        setNewChannelName('');
        setKeyValue('');
      } else {
        onCancel();
      }
    }
  });

  // Handle channel selection from list
  const handleSelect = (item: SelectItem) => {
    if (item.value === NEW_CHANNEL_VALUE) {
      setStep('new-channel');
    } else {
      const existingKey = getKey(item.value);
      setSelectedChannel(item.value);
      setKeyValue(existingKey);
      setStep('edit-key');
    }
  };

  // Handle new channel name submission
  const handleNewChannelSubmit = () => {
    const trimmed = newChannelName.trim();
    if (trimmed) {
      const existingKey = getKey(trimmed);
      setSelectedChannel(trimmed);
      setKeyValue(existingKey);
      setStep('edit-key');
    }
  };

  // Handle key submission (final step)
  const handleKeySubmit = () => {
    onSelect(selectedChannel, keyValue);
  };

  // Skip key editing - use existing key or empty
  const handleSkipKey = () => {
    onSelect(selectedChannel, keyValue);
  };

  // Merge API channels with saved channels
  const allChannelNames = new Set<string>([
    ...apiChannels.filter(ch => ch !== 'default'),
    ...savedChannels.map(ch => ch.name),
  ]);

  // Build items list with key indicator
  const items: SelectItem[] = Array.from(allChannelNames)
    .sort((a, b) => {
      // Current channel first
      if (a === currentChannel) return -1;
      if (b === currentChannel) return 1;
      // Then by last used (from saved channels)
      const savedA = savedChannels.find(c => c.name === a);
      const savedB = savedChannels.find(c => c.name === b);
      if (savedA && savedB) return savedB.lastUsedAt - savedA.lastUsedAt;
      if (savedA) return -1;
      if (savedB) return 1;
      return a.localeCompare(b);
    })
    .map(ch => {
      const hasKey = !!getKey(ch);
      const isCurrent = ch === currentChannel;
      let label = ch;
      if (hasKey) label = `🔑 ${label}`;
      if (isCurrent) label = `${label} (current)`;
      return { label, value: ch };
    });

  // Add "new channel" option
  items.push({
    label: '+ Enter new channel...',
    value: NEW_CHANNEL_VALUE,
  });

  // Find initial index (current channel)
  const initialIndex = items.findIndex(item => item.value === currentChannel);

  if (isLoading) {
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
          <Text bold color="cyan">Select Channel</Text>
        </Box>
        <Text dimColor>Loading channels...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor="red"
        padding={1}
        marginX={2}
        marginY={1}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="red">Error</Text>
        </Box>
        <Text color="red">{error}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to close</Text>
        </Box>
      </Box>
    );
  }

  // Step: Enter new channel name
  if (step === 'new-channel') {
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
          <Text bold color="cyan">Enter Channel Name</Text>
        </Box>
        <Box>
          <Text color="yellow">&gt; </Text>
          <TextInput
            value={newChannelName}
            onChange={setNewChannelName}
            onSubmit={handleNewChannelSubmit}
            placeholder="channel-name"
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter to continue, Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Step: Edit encryption key
  if (step === 'edit-key') {
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
          <Text bold color="cyan">Encryption Key for "{selectedChannel}"</Text>
        </Box>

        {keyValue ? (
          <Box marginBottom={1}>
            <Text dimColor>Current key: </Text>
            <Text color="green">{keyValue.substring(0, 8)}...</Text>
          </Box>
        ) : (
          <Box marginBottom={1}>
            <Text dimColor>No key configured (logs will appear encrypted)</Text>
          </Box>
        )}

        <Box>
          <Text color="yellow">Key: </Text>
          <TextInput
            value={keyValue}
            onChange={setKeyValue}
            onSubmit={handleKeySubmit}
            placeholder="encryption-key (optional)"
          />
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Enter to confirm, Tab to skip, Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Step: Select channel from list
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
        <Text bold color="cyan">Select Channel</Text>
      </Box>

      <SelectInput
        items={items}
        initialIndex={initialIndex >= 0 ? initialIndex : 0}
        onSelect={handleSelect}
        indicatorComponent={({ isSelected }) => (
          <Text color={isSelected ? 'cyan' : undefined}>
            {isSelected ? '❯ ' : '  '}
          </Text>
        )}
        itemComponent={({ isSelected, label }) => (
          <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
            {label}
          </Text>
        )}
      />

      <Box marginTop={1}>
        <Text dimColor>🔑 = has key | ↑↓ Navigate, Enter to select, Esc to cancel</Text>
      </Box>
    </Box>
  );
}
