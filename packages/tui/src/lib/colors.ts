import chalk from 'chalk';
import type { LogLevelLabel } from '../types/index.js';

/**
 * Get color function for log level
 */
export function getLevelColor(level: LogLevelLabel): (text: string) => string {
  switch (level) {
    case 'trace':
      return chalk.gray;
    case 'debug':
      return chalk.cyan;
    case 'info':
      return chalk.green;
    case 'warn':
      return chalk.yellow;
    case 'error':
      return chalk.red;
    case 'fatal':
      return chalk.bgRed.white;
    default:
      return chalk.white;
  }
}

/**
 * Get level badge with color
 */
export function getLevelBadge(level: LogLevelLabel): string {
  const color = getLevelColor(level);
  const label = level.toUpperCase().padEnd(5);
  return color(label);
}

/**
 * Format timestamp
 */
export function formatTime(time: number): string {
  const date = new Date(time);
  return chalk.dim(
    date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  );
}

/**
 * Format namespace
 */
export function formatNamespace(namespace?: string): string {
  if (!namespace) return '';
  return chalk.magenta(`[${namespace}]`);
}

/**
 * Highlight search term in text
 */
export function highlightSearch(text: string, search: string): string {
  if (!search) return text;
  const regex = new RegExp(`(${escapeRegex(search)})`, 'gi');
  return text.replace(regex, chalk.bgYellow.black('$1'));
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip ANSI escape codes from text to get visible length
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Truncate text with ellipsis, accounting for ANSI escape codes
 */
export function truncate(text: string, maxLength: number): string {
  const visibleLength = stripAnsi(text).length;
  if (visibleLength <= maxLength) return text;

  // Need to truncate while preserving ANSI codes
  let visibleCount = 0;
  let i = 0;
  const ansiRegex = /\x1B\[[0-9;]*m/g;
  let result = '';
  let match;

  // Process text character by character, skipping ANSI codes
  while (i < text.length && visibleCount < maxLength - 1) {
    ansiRegex.lastIndex = i;
    match = ansiRegex.exec(text);

    if (match && match.index === i) {
      // Found ANSI code at current position, include it and skip
      result += match[0];
      i += match[0].length;
    } else {
      // Regular character
      result += text[i];
      visibleCount++;
      i++;
    }
  }

  return result + '\u2026' + '\x1B[0m'; // Add ellipsis and reset ANSI
}

/**
 * Status indicator colors
 */
export const statusColors = {
  connected: chalk.green('\u25CF'),
  connecting: chalk.yellow('\u25CF'),
  disconnected: chalk.red('\u25CF'),
  error: chalk.red('\u25CF'),
} as const;
