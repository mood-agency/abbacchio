import type { LogLevelLabel } from '../../types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LEVEL_BADGE_CLASSES } from '@/lib/log-level-colors';

interface LevelBadgeProps {
  level: LogLevelLabel;
}

export function LevelBadge({ level }: LevelBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn('uppercase border-0', LEVEL_BADGE_CLASSES[level])}
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
