import { useCallback, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LogEntry } from '../types';
import { LevelBadge, ChannelBadge } from './ui/CustomBadge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Lock, AlertTriangle, Check, ShieldCheck, ShieldOff, ShieldAlert, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface LogRowProps {
  log: LogEntry;
  showChannel?: boolean;
  searchQuery?: string;
  caseSensitive?: boolean;
  useRegex?: boolean;
  isNew?: boolean;
  /** Whether this row is selected for copy */
  isSelected?: boolean;
  /** Callback for row selection (receives log ID) */
  onSelect?: (logId: string, shiftKey: boolean) => void;
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

interface CopyableCellProps {
  children: React.ReactNode;
  value: string;
  className?: string;
}

function CopyableCell({ children, value, className = '' }: CopyableCellProps) {
  const { t } = useTranslation(['logs', 'common']);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      toast.success(t('logs:toast.valueCopied'));
    }).catch(() => {
      toast.error(t('logs:toast.copyFailed'));
    });
  }, [value, t]);

  return (
    <div className={`group/cell relative flex items-center ${className}`}>
      {children}
      {value && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCopy}
              className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-100 p-1 hover:bg-muted rounded transition-opacity"
            >
              <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('common:actions.copy')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Highlight search matches in text - optimized with fast-path checks
 * Supports both plain text and regex search
 */
function highlightText(text: string, query: string, caseSensitive = false, useRegex = false): React.ReactNode {
  // Fast path: no highlighting needed
  if (!query || !text) return text;

  let regex: RegExp;

  if (useRegex) {
    // Try to create regex from query
    try {
      regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } catch {
      // Invalid regex, return text as-is
      return text;
    }
  } else {
    // Quick check if query exists in text (plain text search)
    const textToCheck = caseSensitive ? text : text.toLowerCase();
    const queryToCheck = caseSensitive ? query : query.toLowerCase();
    if (!textToCheck.includes(queryToCheck)) return text;

    // Create regex with escaped query
    const escaped = escapeRegex(query);
    regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
  }

  // Find all matches and their positions
  const matches: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Skip zero-length matches (e.g., from patterns like "foo|" which match empty string)
    if (match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    matches.push({ start: match.index, end: match.index + match[0].length });
  }

  if (matches.length === 0) return text;

  // Build result with highlighted matches
  const result: React.ReactNode[] = [];
  let lastEnd = 0;

  matches.forEach((m, i) => {
    // Add text before this match
    if (m.start > lastEnd) {
      result.push(text.slice(lastEnd, m.start));
    }
    // Add highlighted match
    result.push(
      <mark key={i} className="search-highlight">
        {text.slice(m.start, m.end)}
      </mark>
    );
    lastEnd = m.end;
  });

  // Add remaining text after last match
  if (lastEnd < text.length) {
    result.push(text.slice(lastEnd));
  }

  return result;
}

/**
 * Highlight search in data (receives pre-computed dataString to avoid JSON.stringify on each render)
 */
function highlightData(
  dataString: string,
  query: string,
  caseSensitive = false,
  useRegex = false
): React.ReactNode {
  // Fast path: no query
  if (!query) {
    return dataString;
  }

  if (!useRegex) {
    // Check if there's a match (plain text search)
    const dataToCheck = caseSensitive ? dataString : dataString.toLowerCase();
    const queryToCheck = caseSensitive ? query : query.toLowerCase();
    if (!dataToCheck.includes(queryToCheck)) {
      return dataString;
    }
  }

  return highlightText(dataString, query, caseSensitive, useRegex);
}

export const LogRow = memo(function LogRow({
  log,
  showChannel = false,
  searchQuery = '',
  caseSensitive = false,
  useRegex = false,
  isNew = false,
  isSelected = false,
  onSelect,
  onDataClick,
}: LogRowProps) {
  const { t } = useTranslation('logs');
  const showData = hasData(log.data);
  const isEncrypted = log.encrypted && !log.decryptionFailed;
  const decryptionFailed = log.decryptionFailed;
  // Check if message was originally sent encrypted (persists after decryption)
  const wasSentEncrypted = log.wasEncrypted === true;

  // Cache the JSON stringified data to avoid recalculating on each render
  const dataString = useMemo(() => JSON.stringify(log.data), [log.data]);

  // Memoize highlighting results to avoid regex operations on every render
  const highlightedMsg = useMemo(
    () => searchQuery ? highlightText(log.msg, searchQuery, caseSensitive, useRegex) : log.msg,
    [log.msg, searchQuery, caseSensitive, useRegex]
  );

  const highlightedData = useMemo(
    () => searchQuery ? highlightData(dataString, searchQuery, caseSensitive, useRegex) : dataString,
    [dataString, searchQuery, caseSensitive, useRegex]
  );

  // Highlight namespace when regex matches
  const highlightedNamespace = useMemo(
    () => log.namespace && searchQuery ? highlightText(log.namespace, searchQuery, caseSensitive, useRegex) : log.namespace,
    [log.namespace, searchQuery, caseSensitive, useRegex]
  );

  // Check if level label matches the search (for highlighting the badge)
  const levelMatchesSearch = useMemo(() => {
    if (!searchQuery || !useRegex) return false;
    try {
      // Don't use 'g' flag for test() to avoid lastIndex issues
      const regex = new RegExp(searchQuery, caseSensitive ? '' : 'i');
      const match = regex.exec(log.levelLabel);
      // Only highlight if there's a non-empty match
      return match !== null && match[0].length > 0;
    } catch {
      return false;
    }
  }, [searchQuery, useRegex, caseSensitive, log.levelLabel]);

  // Handle clicking on the row content to open drawer
  const handleRowClick = useCallback(() => {
    if (onDataClick) {
      onDataClick(log);
    }
  }, [onDataClick, log]);

  // Handle clicking on the selection area for multi-select
  const handleSelectionClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelect) {
      onSelect(log.id, e.shiftKey);
    }
  }, [onSelect, log.id]);

  // Determine row styling based on encryption state, new status, and selection
  const rowClasses = [
    'border-b border-border hover:bg-muted/50 transition-colors select-none',
    decryptionFailed ? 'bg-destructive/5' : '',
    isEncrypted ? 'bg-yellow-500/5' : '',
    isNew ? 'animate-highlight' : '',
    isSelected ? 'bg-primary/10' : '',
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
          <CopyableCell value={formatDateTime(log.time)} className="w-40 flex-shrink-0">
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              {formatDateTime(log.time)}
            </span>
          </CopyableCell>

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
              <LevelBadge level={log.levelLabel} highlight={levelMatchesSearch} />
            )}
          </div>

          {/* Channel (only shown when multiple channels exist) */}
          {showChannel && (
            <CopyableCell value={log.channel} className="w-24 flex-shrink-0">
              <ChannelBadge channel={log.channel} />
            </CopyableCell>
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
              log.namespace && (
                <CopyableCell value={log.namespace} className="w-full">
                  <span className="text-muted-foreground truncate block">{highlightedNamespace}</span>
                </CopyableCell>
              )
            )}
          </div>

          {/* Message */}
          <div className="w-48 flex-shrink-0 text-foreground font-mono text-xs min-w-0">
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
            {!isEncrypted && !decryptionFailed && (
              <CopyableCell value={log.msg} className="w-full">
                <span className="truncate">{highlightedMsg}</span>
              </CopyableCell>
            )}
            {(isEncrypted || decryptionFailed) && (
              <span className={`truncate ${decryptionFailed ? 'text-destructive' : 'text-yellow-400 italic'}`}>
                {highlightedMsg}
              </span>
            )}
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
              <CopyableCell value={dataString} className="w-full">
                <span className="truncate block">{highlightedData}</span>
              </CopyableCell>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
