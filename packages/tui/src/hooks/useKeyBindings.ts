import { useInput } from 'ink';
import { useCallback } from 'react';
import type { LogLevelNumber } from '../types/index.js';

interface KeyBindingsOptions {
  onQuit: () => void;
  onTogglePause: () => void;
  onToggleHelp: () => void;
  onScrollUp: () => void;
  onScrollDown: () => void;
  onScrollTop: () => void;
  onScrollBottom: () => void;
  onSearch: () => void;
  onLevelFilter: (level: LogLevelNumber | null) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function useKeyBindings(options: KeyBindingsOptions): void {
  const {
    onQuit,
    onTogglePause,
    onToggleHelp,
    onScrollUp,
    onScrollDown,
    onScrollTop,
    onScrollBottom,
    onSearch,
    onLevelFilter,
    onClear,
    disabled = false,
  } = options;

  const handleInput = useCallback(
    (input: string, key: { escape?: boolean; upArrow?: boolean; downArrow?: boolean }) => {
      if (disabled) return;

      // Navigation
      if (key.upArrow || input === 'k') {
        onScrollUp();
        return;
      }
      if (key.downArrow || input === 'j') {
        onScrollDown();
        return;
      }

      switch (input) {
        // Quit
        case 'q':
          onQuit();
          break;

        // Pause/Resume
        case 'p':
        case ' ':
          onTogglePause();
          break;

        // Help
        case '?':
          onToggleHelp();
          break;

        // Scroll to top/bottom
        case 'g':
          onScrollTop();
          break;
        case 'G':
          onScrollBottom();
          break;

        // Search
        case '/':
          onSearch();
          break;

        // Level filters (1-6 for trace-fatal, 0 for all)
        case '0':
          onLevelFilter(null);
          break;
        case '1':
          onLevelFilter(10); // trace
          break;
        case '2':
          onLevelFilter(20); // debug
          break;
        case '3':
          onLevelFilter(30); // info
          break;
        case '4':
          onLevelFilter(40); // warn
          break;
        case '5':
          onLevelFilter(50); // error
          break;
        case '6':
          onLevelFilter(60); // fatal
          break;

        // Clear logs
        case 'c':
          onClear();
          break;

        // Escape - could be used for various things
        default:
          if (key.escape) {
            onLevelFilter(null);
          }
          break;
      }
    },
    [
      disabled,
      onQuit,
      onTogglePause,
      onToggleHelp,
      onScrollUp,
      onScrollDown,
      onScrollTop,
      onScrollBottom,
      onSearch,
      onLevelFilter,
      onClear,
    ]
  );

  useInput(handleInput);
}
