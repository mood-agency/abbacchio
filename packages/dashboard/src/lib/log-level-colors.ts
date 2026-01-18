import type { LogLevelLabel, FilterLevel } from '../types';

/**
 * Centralized color definitions for log levels.
 * Used across the sidebar filters and table badges for consistency.
 */

// Hex color values for log level chips (medium saturation palette)
export const LOG_LEVEL_HEX: Record<LogLevelLabel, { bg: string; text: string }> = {
  fatal: { bg: '#E57373', text: '#FFFFFF' },  // Medium red-pink - Critical failure
  error: { bg: '#EF5350', text: '#FFFFFF' },  // Soft red - Non-fatal error
  warn:  { bg: '#FFB74D', text: '#000000' },  // Medium amber - Warning
  info:  { bg: '#64B5F6', text: '#FFFFFF' },  // Medium blue - Normal operational
  debug: { bg: '#9E9E9E', text: '#FFFFFF' },  // Medium grey - Diagnostic info
  trace: { bg: '#BDBDBD', text: '#000000' },  // Light grey - Step-by-step execution
};

// Base color palette for each log level (Tailwind classes for non-badge uses)
export const LOG_LEVEL_COLORS = {
  trace: {
    base: 'slate',
    light: {
      bg: 'bg-slate-100',
      text: 'text-slate-600',
      hover: 'hover:bg-slate-200',
    },
    dark: {
      bg: 'dark:bg-slate-800',
      text: 'dark:text-slate-400',
      hover: 'dark:hover:bg-slate-700',
    },
    accent: 'text-slate-500',
  },
  debug: {
    base: 'gray',
    light: {
      bg: 'bg-gray-100',
      text: 'text-gray-700',
      hover: 'hover:bg-gray-200',
    },
    dark: {
      bg: 'dark:bg-gray-800',
      text: 'dark:text-gray-300',
      hover: 'dark:hover:bg-gray-700',
    },
    accent: 'text-gray-500',
  },
  info: {
    base: 'blue',
    light: {
      bg: 'bg-blue-100',
      text: 'text-blue-700',
      hover: 'hover:bg-blue-200',
    },
    dark: {
      bg: 'dark:bg-blue-900',
      text: 'dark:text-blue-300',
      hover: 'dark:hover:bg-blue-800',
    },
    accent: 'text-blue-500',
  },
  warn: {
    base: 'orange',
    light: {
      bg: 'bg-orange-100',
      text: 'text-orange-700',
      hover: 'hover:bg-orange-200',
    },
    dark: {
      bg: 'dark:bg-orange-900',
      text: 'dark:text-orange-300',
      hover: 'dark:hover:bg-orange-800',
    },
    accent: 'text-orange-500',
  },
  error: {
    base: 'red',
    light: {
      bg: 'bg-red-100',
      text: 'text-red-700',
      hover: 'hover:bg-red-200',
    },
    dark: {
      bg: 'dark:bg-red-900',
      text: 'dark:text-red-300',
      hover: 'dark:hover:bg-red-800',
    },
    accent: 'text-red-500',
  },
  fatal: {
    base: 'rose',
    light: {
      bg: 'bg-rose-100',
      text: 'text-rose-700',
      hover: 'hover:bg-rose-200',
    },
    dark: {
      bg: 'dark:bg-rose-900',
      text: 'dark:text-rose-300',
      hover: 'dark:hover:bg-rose-800',
    },
    accent: 'text-rose-500',
  },
} as const satisfies Record<LogLevelLabel, {
  base: string;
  light: { bg: string; text: string; hover: string };
  dark: { bg: string; text: string; hover: string };
  accent: string;
}>;

/**
 * Pre-built badge class strings for use in table badges/chips.
 * Combines light and dark mode styles with hover states.
 */
export const LEVEL_BADGE_CLASSES: Record<LogLevelLabel, string> = {
  trace: `${LOG_LEVEL_COLORS.trace.light.bg} ${LOG_LEVEL_COLORS.trace.light.text} ${LOG_LEVEL_COLORS.trace.light.hover} ${LOG_LEVEL_COLORS.trace.dark.bg} ${LOG_LEVEL_COLORS.trace.dark.text} ${LOG_LEVEL_COLORS.trace.dark.hover}`,
  debug: `${LOG_LEVEL_COLORS.debug.light.bg} ${LOG_LEVEL_COLORS.debug.light.text} ${LOG_LEVEL_COLORS.debug.light.hover} ${LOG_LEVEL_COLORS.debug.dark.bg} ${LOG_LEVEL_COLORS.debug.dark.text} ${LOG_LEVEL_COLORS.debug.dark.hover}`,
  info: `${LOG_LEVEL_COLORS.info.light.bg} ${LOG_LEVEL_COLORS.info.light.text} ${LOG_LEVEL_COLORS.info.light.hover} ${LOG_LEVEL_COLORS.info.dark.bg} ${LOG_LEVEL_COLORS.info.dark.text} ${LOG_LEVEL_COLORS.info.dark.hover}`,
  warn: `${LOG_LEVEL_COLORS.warn.light.bg} ${LOG_LEVEL_COLORS.warn.light.text} ${LOG_LEVEL_COLORS.warn.light.hover} ${LOG_LEVEL_COLORS.warn.dark.bg} ${LOG_LEVEL_COLORS.warn.dark.text} ${LOG_LEVEL_COLORS.warn.dark.hover}`,
  error: `${LOG_LEVEL_COLORS.error.light.bg} ${LOG_LEVEL_COLORS.error.light.text} ${LOG_LEVEL_COLORS.error.light.hover} ${LOG_LEVEL_COLORS.error.dark.bg} ${LOG_LEVEL_COLORS.error.dark.text} ${LOG_LEVEL_COLORS.error.dark.hover}`,
  fatal: `${LOG_LEVEL_COLORS.fatal.light.bg} ${LOG_LEVEL_COLORS.fatal.light.text} ${LOG_LEVEL_COLORS.fatal.light.hover} ${LOG_LEVEL_COLORS.fatal.dark.bg} ${LOG_LEVEL_COLORS.fatal.dark.text} ${LOG_LEVEL_COLORS.fatal.dark.hover}`,
};

/**
 * Text-only accent colors for sidebar filters.
 * Used when the level is not active/selected.
 */
export const LEVEL_TEXT_COLORS: Record<FilterLevel, string> = {
  all: '',
  trace: LOG_LEVEL_COLORS.trace.accent,
  debug: LOG_LEVEL_COLORS.debug.accent,
  info: LOG_LEVEL_COLORS.info.accent,
  warn: LOG_LEVEL_COLORS.warn.accent,
  error: LOG_LEVEL_COLORS.error.accent,
  fatal: LOG_LEVEL_COLORS.fatal.accent,
};

/**
 * Get the badge classes for a specific log level.
 */
export function getLevelBadgeClasses(level: LogLevelLabel): string {
  return LEVEL_BADGE_CLASSES[level];
}

/**
 * Get the text color class for a specific filter level.
 */
export function getLevelTextColor(level: FilterLevel): string {
  return LEVEL_TEXT_COLORS[level];
}
