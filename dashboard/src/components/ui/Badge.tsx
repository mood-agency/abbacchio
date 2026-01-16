import type { LogLevelLabel } from '../../types';

const levelColors: Record<LogLevelLabel, string> = {
  trace: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  debug: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  info: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  warn: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  fatal: 'bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300',
};

interface LevelBadgeProps {
  level: LogLevelLabel;
}

export function LevelBadge({ level }: LevelBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase ${levelColors[level]}`}
    >
      {level}
    </span>
  );
}

interface NamespaceBadgeProps {
  namespace: string;
}

export function NamespaceBadge({ namespace }: NamespaceBadgeProps) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
      {namespace}
    </span>
  );
}

interface ChannelBadgeProps {
  channel: string;
}

export function ChannelBadge({ channel }: ChannelBadgeProps) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">
      {channel}
    </span>
  );
}
