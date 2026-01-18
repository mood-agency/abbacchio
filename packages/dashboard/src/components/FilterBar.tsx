import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Search, X, CaseSensitive, Link, Save, SaveOff, Trash2, Unplug, Key } from 'lucide-react';
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
              {persistLogs ? <Save className="w-4 h-4" /> : <SaveOff className="w-4 h-4" />}
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
