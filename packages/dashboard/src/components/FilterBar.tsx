import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Search, X, CaseSensitive, Link, Save, SaveOff, Trash2, Unplug, Key, Pause, Play, MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FilterLevels, FilterNamespaces } from '../types';

interface FilterBarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  matchCount?: number;
  caseSensitive: boolean;
  setCaseSensitive: (value: boolean) => void;
  onClearFilters: () => void;
  levelFilters: FilterLevels;
  namespaceFilters: FilterNamespaces;
  // Channel actions
  onCopyLink: () => void;
  persistLogs: boolean;
  onTogglePersist: () => void;
  onClearLogs: () => void;
  onDisconnect: () => void;
  onManageKey: () => void;
  hasSecretKey: boolean;
  hasEncryptedLogs: boolean;
  // Pause/resume
  isPaused: boolean;
  onTogglePause: () => void;
}

export const FilterBar = forwardRef<HTMLInputElement, FilterBarProps>(function FilterBar({
  searchQuery,
  setSearchQuery,
  matchCount,
  caseSensitive,
  setCaseSensitive,
  onClearFilters,
  levelFilters,
  namespaceFilters,
  onCopyLink,
  persistLogs,
  onTogglePersist,
  onClearLogs,
  onDisconnect,
  onManageKey,
  hasSecretKey,
  hasEncryptedLogs,
  isPaused,
  onTogglePause,
}, ref) {
  const { t } = useTranslation('filters');
  const hasFilters = namespaceFilters.length > 0 || searchQuery !== '' || caseSensitive || levelFilters.length > 0;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/50 relative z-10">
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
        {/* Pause/Resume */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${isPaused ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`}
              onClick={onTogglePause}
            >
              {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isPaused ? t('tooltips.resume') : t('tooltips.pause')}</TooltipContent>
        </Tooltip>

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

        {/* More options menu */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('tooltips.moreOptions')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onTogglePersist}>
              {persistLogs ? <SaveOff className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              {persistLogs ? t('tooltips.disablePersistence') : t('tooltips.enablePersistence')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onClearLogs}>
              <Trash2 className="w-4 h-4 mr-2" />
              {t('tooltips.clearLogs')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDisconnect}>
              <Unplug className="w-4 h-4 mr-2" />
              {t('tooltips.disconnect')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
