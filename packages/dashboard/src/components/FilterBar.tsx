import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LevelBadge } from '@/components/ui/CustomBadge';
import { Search, X, CaseSensitive, Link, Database, DatabaseBackup, Trash2, Unplug, Key } from 'lucide-react';
import type { FilterLevel } from '../types';

interface LevelCounts {
  all: number;
  trace: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
}

interface FilterBarProps {
  namespaceFilter: string;
  setNamespaceFilter: (namespace: string) => void;
  availableNamespaces: string[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  matchCount?: number;
  caseSensitive: boolean;
  setCaseSensitive: (value: boolean) => void;
  onClearFilters: () => void;
  levelFilter: FilterLevel;
  setLevelFilter: (level: FilterLevel) => void;
  levelCounts: LevelCounts;
  // Channel actions
  onCopyLink: () => void;
  persistLogs: boolean;
  onTogglePersist: () => void;
  onClearLogs: () => void;
  onDisconnect: () => void;
  onManageKey: () => void;
  hasSecretKey: boolean;
  hasEncryptedLogs: boolean;
}

export const FilterBar = forwardRef<HTMLInputElement, FilterBarProps>(function FilterBar({
  namespaceFilter,
  setNamespaceFilter,
  availableNamespaces,
  searchQuery,
  setSearchQuery,
  matchCount,
  caseSensitive,
  setCaseSensitive,
  onClearFilters,
  levelFilter,
  setLevelFilter,
  levelCounts,
  onCopyLink,
  persistLogs,
  onTogglePersist,
  onClearLogs,
  onDisconnect,
  onManageKey,
  hasSecretKey,
  hasEncryptedLogs,
}, ref) {
  const { t } = useTranslation('filters');
  const hasFilters = namespaceFilter !== '' || searchQuery !== '' || caseSensitive || levelFilter !== 'all';

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/50 relative z-10">
      {/* Level tabs */}
      <Tabs value={levelFilter} onValueChange={(v) => setLevelFilter(v as FilterLevel)}>
        <TabsList className="h-8 bg-transparent p-0 gap-0.5">
          {(['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map((level) => {
            const count = levelCounts[level];
            return (
              <TabsTrigger
                key={level}
                value={level}
                className="h-7 px-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md"
              >
                <span className="flex items-center gap-1.5">
                  {level === 'all' ? (
                    <span className="font-medium uppercase">{t('levels.all')}</span>
                  ) : (
                    <LevelBadge level={level} />
                  )}
                  <span className="tabular-nums text-muted-foreground">
                    {count.toLocaleString()}
                  </span>
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Separator */}
      <div className="h-6 w-px bg-border" />

      {/* Namespace filter */}
      <Select
        value={namespaceFilter || 'all'}
        onValueChange={(value) => setNamespaceFilter(value === 'all' ? '' : value)}
      >
        <SelectTrigger className="w-[160px] h-9">
          <SelectValue placeholder={t('namespace.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('namespace.all')}</SelectItem>
          {availableNamespaces.map((namespace) => (
            <SelectItem key={namespace} value={namespace}>
              {namespace}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Search */}
      <div className="relative flex-1 max-w-md flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            ref={ref}
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-3 h-9"
          />
          {searchQuery && matchCount !== undefined && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {t('search.match', { count: matchCount })}
            </span>
          )}
        </div>
        {/* Case sensitive toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-9 w-9 ${caseSensitive ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
              onClick={() => setCaseSensitive(!caseSensitive)}
            >
              <CaseSensitive className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('tooltips.matchCase')}</TooltipContent>
        </Tooltip>
        {/* Clear filters */}
        {hasFilters && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClearFilters}
                className="h-9 w-9 text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('tooltips.clearFilters')}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side actions */}
      <div className="flex items-center gap-1">
        {/* Key manager */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${
                hasSecretKey
                  ? 'text-green-600 dark:text-green-400'
                  : hasEncryptedLogs
                  ? 'text-yellow-600 dark:text-yellow-400'
                  : 'text-muted-foreground'
              }`}
              onClick={onManageKey}
            >
              <Key className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('tooltips.manageKey')}</TooltipContent>
        </Tooltip>

        {/* Copy link */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={onCopyLink}
            >
              <Link className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('tooltips.copyLink')}</TooltipContent>
        </Tooltip>

        {/* Toggle persistence */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${persistLogs ? 'text-primary' : 'text-muted-foreground'}`}
              onClick={onTogglePersist}
            >
              {persistLogs ? <Database className="w-4 h-4" /> : <DatabaseBackup className="w-4 h-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{persistLogs ? t('tooltips.disablePersistence') : t('tooltips.enablePersistence')}</TooltipContent>
        </Tooltip>

        {/* Clear logs */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onClearLogs}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('tooltips.clearLogs')}</TooltipContent>
        </Tooltip>

        {/* Disconnect */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onDisconnect}
            >
              <Unplug className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('tooltips.disconnect')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});
