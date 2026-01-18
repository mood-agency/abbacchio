import type { LogLevelLabel } from '../../types';
import { Badge } from '@/components/ui/badge';
import { LOG_LEVEL_HEX } from '@/lib/log-level-colors';

interface LevelBadgeProps {
  level: LogLevelLabel;
}

export function LevelBadge({ level }: LevelBadgeProps) {
  const colors = LOG_LEVEL_HEX[level];
  return (
    <Badge
      variant="secondary"
      className="uppercase border-0"
      style={{ backgroundColor: colors.bg, color: colors.text }}
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
