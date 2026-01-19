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
import { FileJson, FileSpreadsheet, Database, Download, Check } from 'lucide-react';
import type { ExportFormat } from '@/lib/format-logs';
import { cn } from '@/lib/utils';

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (format: ExportFormat) => void;
  logCount: number;
  channelName: string;
}

export function ExportDialog({
  open,
  onOpenChange,
  onExport,
  logCount,
  channelName,
}: ExportDialogProps) {
  const { t } = useTranslation('filters');
  const { t: tCommon } = useTranslation('common');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('json');

  const handleExport = () => {
    onExport(selectedFormat);
    onOpenChange(false);
  };

  const formatOptions = [
    {
      value: 'json' as ExportFormat,
      icon: FileJson,
      label: t('export.formats.json.label'),
      description: t('export.formats.json.description'),
    },
    {
      value: 'csv' as ExportFormat,
      icon: FileSpreadsheet,
      label: t('export.formats.csv.label'),
      description: t('export.formats.csv.description'),
    },
    {
      value: 'sql' as ExportFormat,
      icon: Database,
      label: t('export.formats.sql.label'),
      description: t('export.formats.sql.description'),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            {t('export.title')}
          </DialogTitle>
          <DialogDescription>
            {t('export.description', { count: logCount, channel: channelName })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          {formatOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = selectedFormat === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedFormat(option.value)}
                className={cn(
                  'w-full flex items-start gap-3 p-3 rounded-lg border transition-colors text-left',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50 hover:bg-muted/50'
                )}
              >
                <div className={cn(
                  'mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                  isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/50'
                )}>
                  {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{option.label}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon('actions.cancel')}
          </Button>
          <Button onClick={handleExport} disabled={logCount === 0}>
            <Download className="w-4 h-4 mr-2" />
            {t('export.button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
