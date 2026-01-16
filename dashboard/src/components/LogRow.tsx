import { useState, useCallback, memo } from 'react';
import type { LogEntry } from '../types';
import { LevelBadge, NamespaceBadge, ChannelBadge } from './ui/Badge';

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
      '<mark class="bg-yellow-300 dark:bg-yellow-500/50 rounded-sm">$1</mark>'
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
      <mark key={i} className="bg-yellow-300 dark:bg-yellow-500/50 text-inherit rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/** Lock icon for encrypted logs */
function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  );
}

/** Warning icon for decryption failures */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
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
    'border-b border-[var(--border)] hover:bg-[var(--bg-secondary)] transition-colors',
    (showData || decryptionFailed) ? 'cursor-pointer' : '',
    decryptionFailed ? 'bg-red-500/5' : '',
    isEncrypted ? 'bg-yellow-500/5' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClasses} onClick={toggleExpand}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        {/* Time */}
        <span className="text-[var(--text-muted)] font-mono text-xs w-24 flex-shrink-0">
          {formatTime(log.time)}
        </span>

        {/* Level - show lock icon for encrypted logs since actual level is unknown */}
        <div className="w-16 flex-shrink-0">
          {isEncrypted || decryptionFailed ? (
            <span className={`inline-flex items-center ${decryptionFailed ? 'text-red-500' : 'text-yellow-500'}`} title={decryptionFailed ? 'Decryption failed' : 'Encrypted'}>
              <LockIcon className="w-4 h-4" />
            </span>
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
            <span className={`inline-flex items-center ${decryptionFailed ? 'text-red-500' : 'text-yellow-500'}`} title={decryptionFailed ? 'Decryption failed' : 'Encrypted'}>
              <LockIcon className="w-4 h-4" />
            </span>
          ) : (
            log.namespace && <NamespaceBadge namespace={log.namespace} />
          )}
        </div>

        {/* Message */}
        <div className="w-48 flex-shrink-0 truncate text-[var(--text-primary)] flex items-center gap-2">
          {isEncrypted && (
            <span className="inline-flex items-center gap-1 text-yellow-500" title="Encrypted - Enter key to decrypt">
              <LockIcon className="w-4 h-4" />
            </span>
          )}
          {decryptionFailed && (
            <span className="inline-flex items-center gap-1 text-red-500" title="Decryption failed - Check your key">
              <WarningIcon className="w-4 h-4" />
            </span>
          )}
          <span className={decryptionFailed ? 'text-red-400' : isEncrypted ? 'text-yellow-400 italic' : ''}>
            {highlightText(log.msg, searchQuery)}
          </span>
        </div>

        {/* Data column - truncated JSON preview */}
        <div className="flex-1 truncate font-mono text-xs text-[var(--text-muted)]">
          {isEncrypted || decryptionFailed ? (
            <span className={`inline-flex items-center ${decryptionFailed ? 'text-red-500' : 'text-yellow-500'}`} title={decryptionFailed ? 'Decryption failed' : 'Encrypted'}>
              <LockIcon className="w-4 h-4" />
            </span>
          ) : showData ? (
            <span title={JSON.stringify(log.data, null, 2)}>
              {JSON.stringify(log.data)}
            </span>
          ) : null}
        </div>

        {/* Expand indicator */}
        {(showData || decryptionFailed) && (
          <div className="flex-shrink-0 text-[var(--text-muted)]">
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Expanded data */}
      {isExpanded && showData && (
        <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
          <div className="relative bg-[var(--bg-tertiary)] rounded-lg p-3 ml-24">
            <button
              onClick={copyToClipboard}
              className="absolute top-2 right-2 p-1.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="Copy JSON"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </button>
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
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 ml-24">
            <div className="flex items-center gap-2 text-red-400">
              <WarningIcon className="w-5 h-5" />
              <span className="font-medium">Decryption Failed</span>
            </div>
            <p className="text-sm text-red-300/80 mt-1">
              Could not decrypt this log entry. Please check that you've entered the correct encryption key.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
