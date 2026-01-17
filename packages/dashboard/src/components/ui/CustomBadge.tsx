import type { LogLevelLabel } from '../../types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const levelColors: Record<LogLevelLabel, string> = {
  trace: 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700',
  debug: 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200 dark:bg-cyan-900 dark:text-cyan-300 dark:hover:bg-cyan-800',
  info: 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800',
  warn: 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300 dark:hover:bg-amber-800',
  error: 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800',
  fatal: 'bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-700 dark:text-white dark:hover:bg-rose-600',
};

interface LevelBadgeProps {
  level: LogLevelLabel;
}

export function LevelBadge({ level }: LevelBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn('uppercase border-0', levelColors[level])}
    >
      {level}
    </Badge>
  );
}

interface NamespaceBadgeProps {
  namespace: string;
}

export function NamespaceBadge({ namespace }: NamespaceBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className="border-0"
    >
      {namespace}
    </Badge>
  );
}

interface ChannelBadgeProps {
  channel: string;
}

export function ChannelBadge({ channel }: ChannelBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className="border-0"
    >
      {channel}
    </Badge>
  );
}
