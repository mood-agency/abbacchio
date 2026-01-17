import { useState, useCallback, memo } from 'react';
import type { LogEntry } from '../types';
import { LevelBadge, NamespaceBadge, ChannelBadge } from './ui/CustomBadge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Lock, AlertTriangle, Copy, ChevronRight } from 'lucide-react';

interface LogRowProps {
  log: LogEntry;
  showChannel?: boolean;
  searchQuery?: string;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${time}.${ms}`;
}

function syntaxHighlightJson(obj: unknown, searchQuery?: string): string {
  const json = JSON.stringify(obj, null, 2);
  let highlighted = json
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
    .replace(/: (null)/g, ': <span class="json-null">$1</span>');

  // Add search highlighting
  if (searchQuery) {
    const escaped = escapeRegex(searchQuery);
    highlighted = highlighted.replace(
      new RegExp(`(${escaped})(?![^<]*>)`, 'gi'),
      '<mark class="search-highlight">$1</mark>'
    );
  }

  return highlighted;
}

/**
 * Syntax highlight inline JSON (single line preview)
 */
function syntaxHighlightInlineJson(obj: unknown, searchQuery?: string): string {
  const json = JSON.stringify(obj);
  let highlighted = json
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
    .replace(/: (null)/g, ': <span class="json-null">$1</span>');

  // Add search highlighting
  if (searchQuery) {
    const escaped = escapeRegex(searchQuery);
    highlighted = highlighted.replace(
      new RegExp(`(${escaped})(?![^<]*>)`, 'gi'),
      '<mark class="search-highlight">$1</mark>'
    );
  }

  return highlighted;
}

function hasData(data: Record<string, unknown>): boolean {
  return Object.keys(data).length > 0;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight search matches in text
 */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;

  const escaped = escapeRegex(query);
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) return text;

  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="search-highlight">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export const LogRow = memo(function LogRow({ log, showChannel = false, searchQuery = '' }: LogRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const showData = hasData(log.data);
  const isEncrypted = log.encrypted && !log.decryptionFailed;
  const decryptionFailed = log.decryptionFailed;

  const toggleExpand = useCallback(() => {
    if (showData || decryptionFailed) {
      setIsExpanded((prev) => !prev);
    }
  }, [showData, decryptionFailed]);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(log, null, 2));
  }, [log]);

  // Determine row styling based on encryption state
  const rowClasses = [
    'border-b border-border hover:bg-muted/50 transition-colors',
    (showData || decryptionFailed) ? 'cursor-pointer' : '',
    decryptionFailed ? 'bg-destructive/5' : '',
    isEncrypted ? 'bg-yellow-500/5' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClasses} onClick={toggleExpand}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        {/* Time */}
        <span className="text-muted-foreground font-mono text-xs w-24 flex-shrink-0">
          {formatTime(log.time)}
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
                {decryptionFailed ? 'Decryption failed' : 'Encrypted'}
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
        <div className="w-28 flex-shrink-0">
          {isEncrypted || decryptionFailed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`inline-flex items-center ${decryptionFailed ? 'text-destructive' : 'text-yellow-500'}`}>
                  <Lock className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {decryptionFailed ? 'Decryption failed' : 'Encrypted'}
              </TooltipContent>
            </Tooltip>
          ) : (
            log.namespace && <NamespaceBadge namespace={log.namespace} />
          )}
        </div>

        {/* Message */}
        <div className="w-48 flex-shrink-0 truncate text-foreground flex items-center gap-2">
          {isEncrypted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-yellow-500">
                  <Lock className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>Encrypted - Enter key to decrypt</TooltipContent>
            </Tooltip>
          )}
          {decryptionFailed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>Decryption failed - Check your key</TooltipContent>
            </Tooltip>
          )}
          <span className={decryptionFailed ? 'text-destructive' : isEncrypted ? 'text-yellow-400 italic' : ''}>
            {highlightText(log.msg, searchQuery)}
          </span>
        </div>

        {/* Data column - truncated JSON preview with syntax highlighting */}
        <div className="flex-1 truncate font-mono text-xs text-muted-foreground">
          {isEncrypted || decryptionFailed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`inline-flex items-center ${decryptionFailed ? 'text-destructive' : 'text-yellow-500'}`}>
                  <Lock className="w-4 h-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {decryptionFailed ? 'Decryption failed' : 'Encrypted'}
              </TooltipContent>
            </Tooltip>
          ) : showData ? (
            <span
              title={JSON.stringify(log.data, null, 2)}
              dangerouslySetInnerHTML={{ __html: syntaxHighlightInlineJson(log.data, searchQuery) }}
            />
          ) : null}
        </div>

        {/* Expand indicator */}
        {(showData || decryptionFailed) && (
          <div className="flex-shrink-0 text-muted-foreground">
            <ChevronRight
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
          </div>
        )}
      </div>

      {/* Expanded data */}
      {isExpanded && showData && (
        <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
          <div className="relative bg-muted rounded-lg p-3 ml-24">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={copyToClipboard}
                  className="absolute top-2 right-2 h-8 w-8"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy JSON</TooltipContent>
            </Tooltip>
            <pre
              className="font-mono text-xs overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(log.data, searchQuery) }}
            />
          </div>
        </div>
      )}

      {/* Decryption failed message */}
      {isExpanded && decryptionFailed && (
        <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 ml-24">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-medium">Decryption Failed</span>
            </div>
            <p className="text-sm text-destructive/80 mt-1">
              Could not decrypt this log entry. Please check that you've entered the correct encryption key.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
