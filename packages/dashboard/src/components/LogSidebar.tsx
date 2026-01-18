import { useTranslation } from 'react-i18next';
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarSection,
  SidebarSectionTitle,
} from '@/components/ui/sidebar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { LevelBadge } from '@/components/ui/CustomBadge';
import { Calendar, X } from 'lucide-react';
import type { LogLevelLabel, FilterLevels, FilterNamespaces, TimeRange } from '../types';

interface LevelCounts {
  all: number;
  trace: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
}

type NamespaceCounts = Record<string, number>;

interface LogSidebarProps {
  levelFilters: FilterLevels;
  toggleLevel: (level: LogLevelLabel) => void;
  clearLevels: () => void;
  levelCounts: LevelCounts;
  namespaceFilters: FilterNamespaces;
  toggleNamespace: (namespace: string) => void;
  clearNamespaces: () => void;
  availableNamespaces: string[];
  namespaceCounts: NamespaceCounts;
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
}

const LEVELS: LogLevelLabel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const TIME_RANGE_OPTIONS: TimeRange[] = ['30m', '1h', '12h', '1d', '3d', '1w', '2w', 'all'];

export function LogSidebar({
  levelFilters,
  toggleLevel,
  clearLevels,
  levelCounts,
  namespaceFilters,
  toggleNamespace,
  clearNamespaces,
  availableNamespaces,
  namespaceCounts,
  timeRange,
  setTimeRange,
}: LogSidebarProps) {
  const { t } = useTranslation('filters');

  return (
    <Sidebar>
      <SidebarHeader>
        <span className="font-semibold text-sm">{t('sidebar.title')}</span>
      </SidebarHeader>
      <SidebarContent>
        {/* Timeline filter */}
        <SidebarSection>
          <SidebarSectionTitle>{t('sidebar.timeline')}</SidebarSectionTitle>
          <div className="px-2">
            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
              <SelectTrigger className="w-full h-9">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map((range) => (
                  <SelectItem key={range} value={range}>
                    {t(`timeRange.${range}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SidebarSection>

        {/* Level filters */}
        <SidebarSection className="mt-4">
          <div className="flex items-center justify-between">
            <SidebarSectionTitle>{t('sidebar.levels')}</SidebarSectionTitle>
            {levelFilters.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearLevels}
              >
                <X className="w-3 h-3 mr-1" />
                {t('sidebar.clear')}
              </Button>
            )}
          </div>
          {LEVELS.map((level) => {
            const count = levelCounts[level];
            const isChecked = levelFilters.includes(level);
            return (
              <label
                key={level}
                className="flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleLevel(level)}
                  />
                  <LevelBadge level={level} />
                </span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {count.toLocaleString()}
                </span>
              </label>
            );
          })}
        </SidebarSection>

        {/* Namespace filters */}
        {availableNamespaces.length > 0 && (
          <SidebarSection className="mt-4">
            <div className="flex items-center justify-between">
              <SidebarSectionTitle>{t('sidebar.namespaces')}</SidebarSectionTitle>
              {namespaceFilters.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={clearNamespaces}
                >
                  <X className="w-3 h-3 mr-1" />
                  {t('sidebar.clear')}
                </Button>
              )}
            </div>
            {availableNamespaces.map((namespace) => {
              const isChecked = namespaceFilters.includes(namespace);
              const count = namespaceCounts[namespace] ?? 0;
              return (
                <label
                  key={namespace}
                  className="flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleNamespace(namespace)}
                    />
                    <span className="text-sm truncate">{namespace}</span>
                  </span>
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {count.toLocaleString()}
                  </span>
                </label>
              );
            })}
          </SidebarSection>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
