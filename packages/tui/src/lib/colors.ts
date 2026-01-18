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
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '\u2026';
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
