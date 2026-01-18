import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface InteractiveJsonViewProps {
  data: Record<string, unknown>;
}

// Color scheme matching nightOwl theme
const colors = {
  key: 'rgb(127, 219, 202)',      // teal for keys
  string: 'rgb(173, 219, 103)',    // green for strings
  number: 'rgb(247, 140, 108)',    // orange for numbers
  boolean: 'rgb(255, 88, 116)',    // red for booleans
  null: 'rgb(255, 88, 116)',       // red for null
  bracket: 'rgb(199, 146, 234)',   // purple for brackets
  punctuation: 'rgb(199, 146, 234)', // purple for : and ,
};

export function InteractiveJsonView({ data }: InteractiveJsonViewProps) {
  const { t } = useTranslation('logs');

  const handleCopy = useCallback(async (value: string, type: 'key' | 'value') => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t(type === 'key' ? 'toast.keyCopied' : 'toast.valueCopied'));
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [t]);

  return (
    <pre
      className="text-xs rounded p-3 overflow-x-auto font-mono"
      style={{ background: 'transparent', margin: 0 }}
    >
      <JsonNode value={data} onCopy={handleCopy} indent={0} />
    </pre>
  );
}

interface JsonNodeProps {
  value: unknown;
  onCopy: (value: string, type: 'key' | 'value') => void;
  indent: number;
  isLast?: boolean;
}

function JsonNode({ value, onCopy, indent, isLast = true }: JsonNodeProps) {
  const indentStr = '  '.repeat(indent);
  const comma = isLast ? '' : ',';

  if (value === null) {
    return (
      <span
        className="hover:bg-white/10 rounded px-0.5 cursor-context-menu"
        style={{ color: colors.null }}
        onContextMenu={(e) => {
          e.preventDefault();
          onCopy('null', 'value');
        }}
      >
        null{comma}
      </span>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <span
        className="hover:bg-white/10 rounded px-0.5 cursor-context-menu"
        style={{ color: colors.boolean }}
        onContextMenu={(e) => {
          e.preventDefault();
          onCopy(String(value), 'value');
        }}
      >
        {String(value)}{comma}
      </span>
    );
  }

  if (typeof value === 'number') {
    return (
      <span
        className="hover:bg-white/10 rounded px-0.5 cursor-context-menu"
        style={{ color: colors.number }}
        onContextMenu={(e) => {
          e.preventDefault();
          onCopy(String(value), 'value');
        }}
      >
        {value}{comma}
      </span>
    );
  }

  if (typeof value === 'string') {
    return (
      <span
        className="hover:bg-white/10 rounded px-0.5 cursor-context-menu"
        style={{ color: colors.string }}
        onContextMenu={(e) => {
          e.preventDefault();
          onCopy(value, 'value');
        }}
      >
        "{value}"{comma}
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span
          className="hover:bg-white/10 rounded px-0.5 cursor-context-menu"
          style={{ color: colors.bracket }}
          onContextMenu={(e) => {
            e.preventDefault();
            onCopy('[]', 'value');
          }}
        >
          []{comma}
        </span>
      );
    }

    return (
      <span
        className="cursor-context-menu"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCopy(JSON.stringify(value, null, 2), 'value');
        }}
      >
        <span style={{ color: colors.bracket }}>[</span>
        {'\n'}
        {value.map((item, i) => (
          <span key={i}>
            {indentStr}{'  '}
            <JsonNode
              value={item}
              onCopy={onCopy}
              indent={indent + 1}
              isLast={i === value.length - 1}
            />
            {'\n'}
          </span>
        ))}
        {indentStr}<span style={{ color: colors.bracket }}>]{comma}</span>
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return (
        <span
          className="hover:bg-white/10 rounded px-0.5 cursor-context-menu"
          style={{ color: colors.bracket }}
          onContextMenu={(e) => {
            e.preventDefault();
            onCopy('{}', 'value');
          }}
        >
          {'{}'}{comma}
        </span>
      );
    }

    return (
      <span
        className="cursor-context-menu"
        onContextMenu={(e) => {
          // Only copy the whole object if clicking on the bracket
          if ((e.target as HTMLElement).closest('[data-json-key], [data-json-value]')) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onCopy(JSON.stringify(value, null, 2), 'value');
        }}
      >
        <span style={{ color: colors.bracket }}>{'{'}</span>
        {'\n'}
        {entries.map(([key, val], i) => (
          <span key={key}>
            {indentStr}{'  '}
            <span
              data-json-key
              className="hover:bg-white/10 rounded px-0.5 cursor-context-menu"
              style={{ color: colors.key }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCopy(key, 'key');
              }}
            >
              "{key}"
            </span>
            <span style={{ color: colors.punctuation }}>: </span>
            <span data-json-value>
              <JsonNode
                value={val}
                onCopy={onCopy}
                indent={indent + 1}
                isLast={i === entries.length - 1}
              />
            </span>
            {'\n'}
          </span>
        ))}
        {indentStr}<span style={{ color: colors.bracket }}>{'}'}{comma}</span>
      </span>
    );
  }

  // Fallback for unknown types
  return <span>{String(value)}{comma}</span>;
}
