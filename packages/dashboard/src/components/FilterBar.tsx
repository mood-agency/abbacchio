import { forwardRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Search, X, CaseSensitive, Pause, Play, Copy } from 'lucide-react';
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
  // Pause/resume
  isPaused: boolean;
  onTogglePause: () => void;
  // Selection
  selectedCount?: number;
  onCopySelected?: () => void;
  onClearSelection?: () => void;
}

export const FilterBar = memo(forwardRef<HTMLInputElement, FilterBarProps>(function FilterBar({
  searchQuery,
  setSearchQuery,
  matchCount,
  caseSensitive,
  setCaseSensitive,
  onClearFilters,
  levelFilters,
  namespaceFilters,
  isPaused,
  onTogglePause,
  selectedCount = 0,
  onCopySelected,
  onClearSelection,
}, ref) {
  const { t } = useTranslation('filters');
  const hasFilters = namespaceFilters.length > 0 || searchQuery !== '' || caseSensitive || levelFilters.length > 0;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background relative z-10">
      {/* Pause/Resume */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`h-9 w-9 ${isPaused ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`}
            onClick={onTogglePause}
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isPaused ? t('tooltips.resume') : t('tooltips.pause')}</TooltipContent>
      </Tooltip>

      {/* Divider */}
      <div className="h-6 w-px bg-border" />

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

      {/* Selection indicator - right side */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-sm text-muted-foreground">
            {t('selection.count', { count: selectedCount })}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary"
                onClick={onCopySelected}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('selection.copy')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={onClearSelection}
              >
                <X className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('selection.clear')}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}));
