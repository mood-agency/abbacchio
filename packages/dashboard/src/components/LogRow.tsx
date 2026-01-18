import { useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LogEntry } from '../types';
import { LevelBadge, ChannelBadge } from './ui/CustomBadge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Lock, AlertTriangle, ShieldCheck, ShieldOff, ShieldAlert, Check } from 'lucide-react';

interface LogRowProps {
  log: LogEntry;
  showChannel?: boolean;
  searchQuery?: string;
  caseSensitive?: boolean;
  isNew?: boolean;
  /** Whether this row is selected for copy */
  isSelected?: boolean;
  /** Index of this row in the list */
  rowIndex?: number;
  /** Callback for row selection */
  onSelect?: (index: number, shiftKey: boolean) => void;
  /** Callback when clicking on the data column to open drawer */
  onDataClick?: (log: LogEntry) => void;
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const dateStr = date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
  });
  const time = date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${dateStr} ${time}.${ms}`;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasData(data: Record<string, unknown>): boolean {
  return Object.keys(data).length > 0;
}

/**
 * Highlight search matches in text - optimized with fast-path checks
 */
function highlightText(text: string, query: string, caseSensitive = false): React.ReactNode {
  // Fast path: no highlighting needed
  if (!query || !text) return text;

  // Quick check if query exists in text
  const textToCheck = caseSensitive ? text : text.toLowerCase();
  const queryToCheck = caseSensitive ? query : query.toLowerCase();
  if (!textToCheck.includes(queryToCheck)) return text;

  // Split by pattern using native regex
  const escaped = escapeRegex(query);
  const regex = new RegExp(`(${escaped})`, caseSensitive ? 'g' : 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    const matches = caseSensitive ? part === query : part.toLowerCase() === query.toLowerCase();
    return matches ? (
      <mark key={i} className="search-highlight">
        {part}
      </mark>
    ) : (
      part
    );
  });
}

/**
 * Highlight search in data
 */
function highlightData(
  data: Record<string, unknown>,
  query: string,
  caseSensitive = false
): React.ReactNode {
  const dataString = JSON.stringify(data);

  // Fast path: no query
  if (!query) {
    return dataString;
  }

  // Check if there's a match
  const dataToCheck = caseSensitive ? dataString : dataString.toLowerCase();
  const queryToCheck = caseSensitive ? query : query.toLowerCase();
  if (!dataToCheck.includes(queryToCheck)) {
    return dataString;
  }

  return highlightText(dataString, query, caseSensitive);
}

export const LogRow = memo(function LogRow({
  log,
  showChannel = false,
  searchQuery = '',
  caseSensitive = false,
  isNew = false,
  isSelected = false,
  rowIndex,
  onSelect,
  onDataClick,
}: LogRowProps) {
  const { t } = useTranslation('logs');
  const showData = hasData(log.data);
  const isEncrypted = log.encrypted && !log.decryptionFailed;
  const decryptionFailed = log.decryptionFailed;
  // Check if message was originally sent encrypted (persists after decryption)
  const wasSentEncrypted = log.wasEncrypted === true;

  // Handle clicking on the row content to open drawer
  const handleRowClick = useCallback(() => {
    if (onDataClick) {
      onDataClick(log);
    }
  }, [onDataClick, log]);

  // Handle clicking on the selection area for multi-select
  const handleSelectionClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelect && rowIndex !== undefined) {
      onSelect(rowIndex, e.shiftKey);
    }
  }, [onSelect, rowIndex]);

  // Determine row styling based on encryption state, new status, and selection
  const rowClasses = [
    'border-b border-border hover:bg-muted/50 transition-colors select-none',
    decryptionFailed ? 'bg-destructive/5' : '',
    isEncrypted ? 'bg-yellow-500/5' : '',
    isNew ? 'animate-highlight' : '',
    isSelected ? 'bg-primary/10 border-primary/30' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClasses}>
      {/* Main row */}
      <div className="flex items-center text-sm">
        {/* Selection area */}
        <div
          className="w-10 flex-shrink-0 flex items-center justify-center py-2 cursor-pointer hover:bg-muted/80 border-r border-border"
          onClick={handleSelectionClick}
        >
          <div className={`w-4 h-4 rounded border ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/50'} flex items-center justify-center transition-colors`}>
            {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
          </div>
        </div>

        {/* Clickable row content */}
        <div
          className="flex-1 flex items-center gap-3 px-4 py-2 cursor-pointer"
          onClick={handleRowClick}
        >
          {/* Date/Time */}
          <span className="text-muted-foreground font-mono text-xs w-36 flex-shrink-0 tabular-nums">
          {formatDateTime(log.time)}
        </span>

        {/* Level - show lock icon for encrypted logs since actual level is unknown */}
        <div className="w-16 flex-shrink-0">
          {isEncrypted || decryptionFailed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`inline-flex items-center ${decryptionFailed ? 'text-destructive' : 'text-yellow-500'}`}>
                  <Lock className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {decryptionFailed ? t('encryption.decryptionFailed') : t('encryption.encrypted')}
              </TooltipContent>
            </Tooltip>
          ) : (
            <LevelBadge level={log.levelLabel} />
          )}
        </div>

        {/* Channel (only shown when multiple channels exist) */}
        {showChannel && (
          <div className="w-24 flex-shrink-0">
            <ChannelBadge channel={log.channel} />
          </div>
        )}

        {/* Namespace - show lock icon for encrypted logs */}
        <div className="w-28 flex-shrink-0 font-mono text-xs">
          {isEncrypted || decryptionFailed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`inline-flex items-center ${decryptionFailed ? 'text-destructive' : 'text-yellow-500'}`}>
                  <Lock className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {decryptionFailed ? t('encryption.decryptionFailed') : t('encryption.encrypted')}
              </TooltipContent>
            </Tooltip>
          ) : (
            log.namespace && <span className="text-muted-foreground truncate block">{log.namespace}</span>
          )}
        </div>

        {/* Message */}
        <div className="w-48 flex-shrink-0 text-foreground flex items-center gap-2 font-mono text-xs min-w-0">
          {isEncrypted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-yellow-500 flex-shrink-0">
                  <Lock className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('encryption.enterKeyToDecrypt')}</TooltipContent>
            </Tooltip>
          )}
          {decryptionFailed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-destructive flex-shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('encryption.checkYourKey')}</TooltipContent>
            </Tooltip>
          )}
          <span className={`truncate ${decryptionFailed ? 'text-destructive' : isEncrypted ? 'text-yellow-400 italic' : ''}`}>
            {highlightText(log.msg, searchQuery, caseSensitive)}
          </span>
        </div>

        {/* Encryption status icon */}
        <div className="w-5 flex-shrink-0 flex items-center justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              {decryptionFailed ? (
                <ShieldAlert className="w-4 h-4 text-yellow-500" />
              ) : wasSentEncrypted ? (
                <ShieldCheck className="w-4 h-4 text-green-500" />
              ) : (
                <ShieldOff className="w-4 h-4 text-destructive" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {decryptionFailed ? t('encryption.decryptionFailed') : wasSentEncrypted ? t('encryption.encryptedAtSource') : t('encryption.notEncrypted')}
            </TooltipContent>
          </Tooltip>
        </div>

          {/* Data column */}
          <div className="flex-1 font-mono text-xs text-muted-foreground min-w-0">
            {isEncrypted || decryptionFailed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`inline-flex items-center ${decryptionFailed ? 'text-destructive' : 'text-yellow-500'}`}>
                    <Lock className="w-4 h-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {decryptionFailed ? t('encryption.decryptionFailed') : t('encryption.encrypted')}
                </TooltipContent>
              </Tooltip>
            ) : showData ? (
              <span className="truncate block">{highlightData(log.data, searchQuery, caseSensitive)}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
