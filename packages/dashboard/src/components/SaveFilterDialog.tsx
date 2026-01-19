import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FilterLevels, FilterNamespaces, TimeRange } from '../types';

interface SaveFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
  currentFilters: {
    levels: FilterLevels;
    namespaces: FilterNamespaces;
    timeRange: TimeRange;
    search: string;
    caseSensitive: boolean;
    useRegex: boolean;
  };
}

export function SaveFilterDialog({
  open,
  onOpenChange,
  onSave,
  currentFilters,
}: SaveFilterDialogProps) {
  const { t } = useTranslation('filters');
  const { t: tCommon } = useTranslation('common');
  const [filterName, setFilterName] = useState('');

  const handleSave = () => {
    if (filterName.trim()) {
      onSave(filterName.trim());
      setFilterName('');
      onOpenChange(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  // Generate a summary of current filters
  const filterSummary: string[] = [];
  if (currentFilters.levels.length > 0) {
    filterSummary.push(t('savedFilters.summary.levels', { count: currentFilters.levels.length }));
  }
  if (currentFilters.namespaces.length > 0) {
    filterSummary.push(t('savedFilters.summary.namespaces', { count: currentFilters.namespaces.length }));
  }
  if (currentFilters.timeRange !== 'all') {
    filterSummary.push(t(`timeRange.${currentFilters.timeRange}`));
  }
  if (currentFilters.search) {
    filterSummary.push(t('savedFilters.summary.search', { query: currentFilters.search }));
  }
  if (currentFilters.caseSensitive) {
    filterSummary.push(t('savedFilters.summary.caseSensitive'));
  }
  if (currentFilters.useRegex) {
    filterSummary.push(t('savedFilters.summary.useRegex'));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('savedFilters.dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('savedFilters.dialog.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('savedFilters.dialog.nameLabel')}</label>
            <Input
              type="text"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('savedFilters.dialog.namePlaceholder')}
              autoFocus
            />
          </div>
          {filterSummary.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                {t('savedFilters.dialog.includedFilters')}
              </label>
              <div className="flex flex-wrap gap-2">
                {filterSummary.map((item, index) => (
                  <span
                    key={index}
                    className="text-xs bg-muted px-2 py-1 rounded-md"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!filterName.trim()}>
            {tCommon('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
