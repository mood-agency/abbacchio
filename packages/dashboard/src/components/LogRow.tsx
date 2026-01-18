import { useState, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LogEntry } from '../types';
import { LevelBadge, ChannelBadge } from './ui/CustomBadge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CodeBlock } from '@/components/ui/code-block';
import { Lock, AlertTriangle, Copy, ChevronRight, ShieldCheck, ShieldOff, ShieldAlert } from 'lucide-react';

interface LogRowProps {
  log: LogEntry;
  showChannel?: boolean;
  searchQuery?: string;
  caseSensitive?: boolean;
  isNew?: boolean;
  /** Disable row expansion (useful for compact views like onboarding) */
  disableExpand?: boolean;
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

export const LogRow = memo(function LogRow({ log, showChannel = false, searchQuery = '', caseSensitive = false, isNew = false, disableExpand = false }: LogRowProps) {
  const { t } = useTranslation('logs');
  const { t: tDialogs } = useTranslation('dialogs');
  const [isExpanded, setIsExpanded] = useState(false);
  const showData = hasData(log.data);
  const isEncrypted = log.encrypted && !log.decryptionFailed;
  const decryptionFailed = log.decryptionFailed;
  // Check if message was originally sent encrypted (persists after decryption)
  const wasSentEncrypted = log.wasEncrypted === true;
  // Whether expansion is allowed
  const canExpand = !disableExpand && (showData || decryptionFailed);

  const toggleExpand = useCallback(() => {
    if (canExpand) {
      setIsExpanded((prev) => !prev);
    }
  }, [canExpand]);

  const copyToClipboard = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(log.data, null, 2));
  }, [log.data]);

  // Determine row styling based on encryption state and new status
  const rowClasses = [
    'border-b border-border hover:bg-muted/50 transition-colors',
    canExpand ? 'cursor-pointer' : '',
    decryptionFailed ? 'bg-destructive/5' : '',
    isEncrypted ? 'bg-yellow-500/5' : '',
    isNew ? 'animate-highlight' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClasses} onClick={toggleExpand}>
      {/* Main row */}
      <div className="flex items-start gap-3 px-4 py-2 text-sm">
        {/* Date/Time */}
        <span className="text-muted-foreground font-mono text-xs w-36 flex-shrink-0 tabular-nums">
          {formatDateTime(log.time)}
        </span>

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
        <div className="w-48 flex-shrink-0 truncate text-foreground flex items-center gap-2 font-mono text-xs">
          {isEncrypted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-yellow-500">
                  <Lock className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('encryption.enterKeyToDecrypt')}</TooltipContent>
            </Tooltip>
          )}
          {decryptionFailed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('encryption.checkYourKey')}</TooltipContent>
            </Tooltip>
          )}
          <span className={decryptionFailed ? 'text-destructive' : isEncrypted ? 'text-yellow-400 italic' : ''}>
            {highlightText(log.msg, searchQuery, caseSensitive)}
          </span>
        </div>

        {/* Data column - expandable JSON payload */}
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
            isExpanded ? (
              <div className="relative my-1" onClick={(e) => e.stopPropagation()}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={copyToClipboard}
                      className="absolute top-1 left-1 h-6 w-6 z-10"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('tooltips.copyJson')}</TooltipContent>
                </Tooltip>
                <CodeBlock
                  code={JSON.stringify(log.data, null, 2)}
                  language="json"
                />
              </div>
            ) : (
              <span className="truncate block">{highlightData(log.data, searchQuery, caseSensitive)}</span>
            )
          ) : null}
        </div>

        {/* Expand indicator */}
        {canExpand && (
          <div className="flex-shrink-0 text-muted-foreground">
            <ChevronRight
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
          </div>
        )}
      </div>

      {/* Decryption failed message */}
      {isExpanded && decryptionFailed && (
        <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 ml-24">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-medium">{tDialogs('decryptionFailed.title')}</span>
            </div>
            <p className="text-sm text-destructive/80 mt-1">
              {tDialogs('decryptionFailed.description')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
