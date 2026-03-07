import { useCallback, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface InteractiveJsonViewProps {
  data: Record<string, unknown>;
  /** Maximum number of entries to show before truncating (default: 50) */
  maxEntries?: number;
  /** Maximum depth to render before collapsing (default: 10) */
  maxDepth?: number;
}

// Theme-aware color classes using CSS custom properties
const colorClasses = {
  key: 'text-json-key',
  string: 'text-json-string',
  number: 'text-json-number',
  boolean: 'text-json-boolean',
  null: 'text-json-null',
  bracket: 'text-json-bracket',
  punctuation: 'text-json-punctuation',
  muted: 'text-json-muted',
};

// Default limits for performance
const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_MAX_DEPTH = 10;

export function InteractiveJsonView({
  data,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxDepth = DEFAULT_MAX_DEPTH,
}: InteractiveJsonViewProps) {
  const { t } = useTranslation('logs');

  const handleCopy = useCallback(async (value: string, type: 'key' | 'value') => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t(type === 'key' ? 'toast.keyCopied' : 'toast.valueCopied'));
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [t]);

  const handleCopyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      toast.success(t('toast.dataCopied'));
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [data, t]);

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={handleCopyAll}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('tooltips.copyJson')}</TooltipContent>
      </Tooltip>
      <pre
        className="text-xs rounded p-3 overflow-x-auto font-mono"
        style={{ background: 'transparent', margin: 0 }}
      >
        <JsonNode
          value={data}
          onCopy={handleCopy}
          indent={0}
          depth={0}
          maxEntries={maxEntries}
          maxDepth={maxDepth}
        />
      </pre>
    </div>
  );
}

interface JsonNodeProps {
  value: unknown;
  onCopy: (value: string, type: 'key' | 'value') => void;
  indent: number;
  depth: number;
  maxEntries: number;
  maxDepth: number;
  isLast?: boolean;
}

// Memoized primitive value renderer
const PrimitiveValue = memo(function PrimitiveValue({
  value,
  onCopy,
  comma,
  type,
}: {
  value: string | number | boolean | null;
  onCopy: (value: string, type: 'key' | 'value') => void;
  comma: string;
  type: 'string' | 'number' | 'boolean' | 'null';
}) {
  const colorClass = colorClasses[type];
  const displayValue = type === 'string' ? `"${value}"` : String(value);
  const copyValue = String(value);

  return (
    <span
      className={`hover:bg-muted rounded px-0.5 cursor-context-menu ${colorClass}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onCopy(copyValue, 'value');
      }}
    >
      {displayValue}{comma}
    </span>
  );
});

// Memoized JSON node component
const JsonNode = memo(function JsonNode({
  value,
  onCopy,
  indent,
  depth,
  maxEntries,
  maxDepth,
  isLast = true,
}: JsonNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 3); // Auto-collapse deep nodes
  const [showAll, setShowAll] = useState(false);

  const indentStr = '  '.repeat(indent);
  const comma = isLast ? '' : ',';

  // Primitives
  if (value === null) {
    return <PrimitiveValue value={null} onCopy={onCopy} comma={comma} type="null" />;
  }

  if (typeof value === 'boolean') {
    return <PrimitiveValue value={value} onCopy={onCopy} comma={comma} type="boolean" />;
  }

  if (typeof value === 'number') {
    return <PrimitiveValue value={value} onCopy={onCopy} comma={comma} type="number" />;
  }

  if (typeof value === 'string') {
    return <PrimitiveValue value={value} onCopy={onCopy} comma={comma} type="string" />;
  }

  // Check depth limit
  if (depth >= maxDepth) {
    return (
      <span
        className={`hover:bg-muted rounded px-0.5 cursor-pointer ${colorClasses.muted}`}
        onClick={() => setIsExpanded(!isExpanded)}
        title="Click to expand (depth limit reached)"
      >
        {Array.isArray(value) ? `[...${value.length} items]` : `{...${Object.keys(value as object).length} keys}`}{comma}
      </span>
    );
  }

  // Arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span
          className={`hover:bg-muted rounded px-0.5 cursor-context-menu ${colorClasses.bracket}`}
          onContextMenu={(e) => {
            e.preventDefault();
            onCopy('[]', 'value');
          }}
        >
          []{comma}
        </span>
      );
    }

    const displayItems = showAll ? value : value.slice(0, maxEntries);
    const hiddenCount = value.length - displayItems.length;

    return (
      <span
        className="cursor-context-menu"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCopy(JSON.stringify(value, null, 2), 'value');
        }}
      >
        <span
          className={`cursor-pointer hover:bg-muted rounded ${colorClasses.bracket}`}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <ChevronDown className="inline w-3 h-3" /> : <ChevronRight className="inline w-3 h-3" />}
          {'['}
        </span>
        {!isExpanded ? (
          <span className={colorClasses.muted}>{`...${value.length} items`}</span>
        ) : (
          <>
            {'\n'}
            {displayItems.map((item, i) => (
              <span key={i}>
                {indentStr}{'  '}
                <JsonNode
                  value={item}
                  onCopy={onCopy}
                  indent={indent + 1}
                  depth={depth + 1}
                  maxEntries={maxEntries}
                  maxDepth={maxDepth}
                  isLast={i === displayItems.length - 1 && hiddenCount === 0}
                />
                {'\n'}
              </span>
            ))}
            {hiddenCount > 0 && (
              <span>
                {indentStr}{'  '}
                <span
                  className={`cursor-pointer hover:underline ${colorClasses.muted}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAll(true);
                  }}
                >
                  ...and {hiddenCount} more items (click to show all)
                </span>
                {'\n'}
              </span>
            )}
            {indentStr}
          </>
        )}
        <span className={colorClasses.bracket}>]{comma}</span>
      </span>
    );
  }

  // Objects
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return (
        <span
          className={`hover:bg-muted rounded px-0.5 cursor-context-menu ${colorClasses.bracket}`}
          onContextMenu={(e) => {
            e.preventDefault();
            onCopy('{}', 'value');
          }}
        >
          {'{}'}{comma}
        </span>
      );
    }

    const displayEntries = showAll ? entries : entries.slice(0, maxEntries);
    const hiddenCount = entries.length - displayEntries.length;

    return (
      <span
        className="cursor-context-menu"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-json-key], [data-json-value]')) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onCopy(JSON.stringify(value, null, 2), 'value');
        }}
      >
        <span
          className={`cursor-pointer hover:bg-muted rounded ${colorClasses.bracket}`}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <ChevronDown className="inline w-3 h-3" /> : <ChevronRight className="inline w-3 h-3" />}
          {'{'}
        </span>
        {!isExpanded ? (
          <span className={colorClasses.muted}>{`...${entries.length} keys`}</span>
        ) : (
          <>
            {'\n'}
            {displayEntries.map(([key, val], i) => (
              <span key={key}>
                {indentStr}{'  '}
                <span
                  data-json-key
                  className={`hover:bg-muted rounded px-0.5 cursor-context-menu ${colorClasses.key}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCopy(key, 'key');
                  }}
                >
                  "{key}"
                </span>
                <span className={colorClasses.punctuation}>: </span>
                <span data-json-value>
                  <JsonNode
                    value={val}
                    onCopy={onCopy}
                    indent={indent + 1}
                    depth={depth + 1}
                    maxEntries={maxEntries}
                    maxDepth={maxDepth}
                    isLast={i === displayEntries.length - 1 && hiddenCount === 0}
                  />
                </span>
                {'\n'}
              </span>
            ))}
            {hiddenCount > 0 && (
              <span>
                {indentStr}{'  '}
                <span
                  className={`cursor-pointer hover:underline ${colorClasses.muted}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAll(true);
                  }}
                >
                  ...and {hiddenCount} more keys (click to show all)
                </span>
                {'\n'}
              </span>
            )}
            {indentStr}
          </>
        )}
        <span className={colorClasses.bracket}>{'}'}{comma}</span>
      </span>
    );
  }

  // Fallback for unknown types
  return <span>{String(value)}{comma}</span>;
});
