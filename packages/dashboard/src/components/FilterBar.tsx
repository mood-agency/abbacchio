import { forwardRef, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Search, X, CaseSensitive, Pause, Play, Copy, Save, Filter, Trash2, Regex } from 'lucide-react';
import type { FilterLevels, FilterNamespaces, TimeRange } from '../types';
import type { SavedFilter } from '../hooks/useSavedFilters';

interface FilterBarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  matchCount?: number;
  caseSensitive: boolean;
  setCaseSensitive: (value: boolean) => void;
  useRegex: boolean;
  setUseRegex: (value: boolean) => void;
  regexError?: string | null;
  onClearFilters: () => void;
  levelFilters: FilterLevels;
  namespaceFilters: FilterNamespaces;
  timeRange?: TimeRange;
  // Pause/resume
  isPaused: boolean;
  onTogglePause: () => void;
  // Selection
  selectedCount?: number;
  onCopySelected?: () => void;
  onClearSelection?: () => void;
  // Saved filters
  savedFilters?: SavedFilter[];
  onSaveFilter?: () => void;
  onLoadFilter?: (filter: SavedFilter) => void;
  onDeleteFilter?: (filterId: string) => void;
}

export const FilterBar = memo(forwardRef<HTMLInputElement, FilterBarProps>(function FilterBar({
  searchQuery,
  setSearchQuery,
  matchCount,
  caseSensitive,
  setCaseSensitive,
  useRegex,
  setUseRegex,
  regexError,
  onClearFilters,
  levelFilters,
  namespaceFilters,
  timeRange = 'all',
  isPaused,
  onTogglePause,
  selectedCount = 0,
  onCopySelected,
  onClearSelection,
  savedFilters = [],
  onSaveFilter,
  onLoadFilter,
  onDeleteFilter,
}, ref) {
  const { t } = useTranslation('filters');
  const { t: tCommon } = useTranslation('common');
  const [savedFiltersOpen, setSavedFiltersOpen] = useState(false);
  const [deleteConfirmFilter, setDeleteConfirmFilter] = useState<SavedFilter | null>(null);
  const hasFilters = namespaceFilters.length > 0 || searchQuery !== '' || caseSensitive || useRegex || levelFilters.length > 0 || timeRange !== 'all';

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
      <div className="relative max-w-md flex items-center gap-1">
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
        {/* Regex toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-9 w-9 ${useRegex ? (regexError ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary') : 'text-muted-foreground'}`}
              onClick={() => setUseRegex(!useRegex)}
            >
              <Regex className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {regexError ? t('tooltips.regexError', { error: regexError }) : t('tooltips.useRegex')}
          </TooltipContent>
        </Tooltip>
        {/* Clear filters */}
        {hasFilters && (
          <>
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
            <div className="h-6 w-px bg-border" />
          </>
        )}
        {/* Saved filters dropdown - only show when there are saved filters */}
        {savedFilters.length > 0 && (
          <Popover open={savedFiltersOpen} onOpenChange={setSavedFiltersOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground"
                  >
                    <Filter className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('savedFilters.tooltip')}</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-64 p-0" align="start">
              <Command>
                <CommandInput placeholder={t('savedFilters.searchPlaceholder')} />
                <CommandList>
                  <CommandEmpty>{t('savedFilters.noResults')}</CommandEmpty>
                  <CommandGroup>
                    {savedFilters.map((filter) => (
                      <CommandItem
                        key={filter.id}
                        value={filter.name}
                        onSelect={() => {
                          onLoadFilter?.(filter);
                          setSavedFiltersOpen(false);
                        }}
                        className="flex items-center justify-between group cursor-pointer"
                      >
                        <span className="truncate flex-1">{filter.name}</span>
                        <button
                          type="button"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmFilter(filter);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
        {/* Save filter button - only show when there are active filters */}
        {hasFilters && onSaveFilter && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onSaveFilter}
                className="h-9 w-9 text-primary hover:text-primary"
              >
                <Save className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('savedFilters.save')}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Selection indicator - next to search */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-1">
          <div className="h-6 w-px bg-border" />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
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

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteConfirmFilter} onOpenChange={(open) => !open && setDeleteConfirmFilter(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('savedFilters.deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('savedFilters.deleteConfirm.description', { name: deleteConfirmFilter?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirmFilter) {
                  onDeleteFilter?.(deleteConfirmFilter.id);
                  setDeleteConfirmFilter(null);
                }
              }}
            >
              {tCommon('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}));
