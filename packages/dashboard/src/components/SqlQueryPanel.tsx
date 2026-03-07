import { useRef, useCallback, useMemo } from 'react';
import { useSqlQuery } from '@/hooks/useSqlQuery';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, Loader2, Clock, AlertCircle, History, X } from 'lucide-react';

type TokenType = 'keyword' | 'function' | 'string' | 'number' | 'operator' | 'comment' | 'plain';

interface SqlToken {
  type: TokenType;
  value: string;
}

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'AS',
  'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT', 'INTO',
  'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'UNION', 'ALL', 'DISTINCT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'BETWEEN', 'LIKE', 'ASC',
  'DESC', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CAST', 'COALESCE', 'TRUE',
  'FALSE', 'WITH', 'RECURSIVE', 'EXCEPT', 'INTERSECT', 'OVER', 'PARTITION',
  'WINDOW', 'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'CURRENT',
  'ROW', 'FILTER', 'REPLACE', 'PRAGMA', 'EXPLAIN', 'QUERY', 'PLAN',
]);

const SQL_FUNCTIONS = new Set([
  'json_extract', 'json_type', 'json_array', 'json_object', 'json_group_array',
  'json_group_object', 'json_each', 'json_tree', 'json_valid', 'json_quote',
  'strftime', 'datetime', 'date', 'time', 'julianday', 'unixepoch',
  'abs', 'length', 'lower', 'upper', 'trim', 'ltrim', 'rtrim', 'substr',
  'replace', 'instr', 'hex', 'typeof', 'ifnull', 'nullif', 'iif',
  'total', 'group_concat', 'random', 'round', 'printf', 'unicode', 'char',
]);

function tokenizeSql(code: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;

  while (i < code.length) {
    // Single-line comments
    if (code[i] === '-' && code[i + 1] === '-') {
      const end = code.indexOf('\n', i);
      const commentEnd = end === -1 ? code.length : end;
      tokens.push({ type: 'comment', value: code.slice(i, commentEnd) });
      i = commentEnd;
      continue;
    }

    // Strings (single-quoted)
    if (code[i] === "'") {
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === "'" && code[j + 1] === "'") { j += 2; continue; }
        if (code[j] === "'") { j++; break; }
        j++;
      }
      tokens.push({ type: 'string', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/\d/.test(code[i]) && (i === 0 || /[\s,()=<>!+\-*/]/.test(code[i - 1]))) {
      let j = i;
      while (j < code.length && /[\d.]/.test(code[j])) j++;
      tokens.push({ type: 'number', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Words (keywords, functions, identifiers)
    if (/[a-zA-Z_]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const upper = word.toUpperCase();

      // Check for function (word followed by parenthesis)
      const rest = code.slice(j).trimStart();
      if (SQL_FUNCTIONS.has(word.toLowerCase()) || (SQL_FUNCTIONS.has(word) && rest[0] === '(')) {
        tokens.push({ type: 'function', value: word });
      } else if (SQL_KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: word });
      } else {
        tokens.push({ type: 'plain', value: word });
      }
      i = j;
      continue;
    }

    // Operators
    if (/[=<>!+\-*/%|&]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[=<>!]/.test(code[j])) j++;
      if (j === i) j++;
      tokens.push({ type: 'operator', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Everything else (whitespace, punctuation)
    tokens.push({ type: 'plain', value: code[i] });
    i++;
  }

  return tokens;
}

const TOKEN_CLASSES: Record<TokenType, string> = {
  keyword: 'text-sql-keyword font-semibold',
  function: 'text-sql-function',
  string: 'text-sql-string',
  number: 'text-sql-number',
  operator: 'text-sql-operator',
  comment: 'text-sql-comment italic',
  plain: '',
};

function SqlHighlight({ code }: { code: string }) {
  const tokens = useMemo(() => tokenizeSql(code), [code]);
  return (
    <>
      {tokens.map((token, i) => (
        token.type === 'plain'
          ? <span key={i}>{token.value}</span>
          : <span key={i} className={TOKEN_CLASSES[token.type]}>{token.value}</span>
      ))}
      {/* Trailing newline to match textarea behavior */}
      {'\n'}
    </>
  );
}

const EXAMPLE_QUERIES = [
  { label: 'All logs', sql: 'SELECT * FROM logs LIMIT 100' },
  { label: 'Count by level', sql: 'SELECT level_label, COUNT(*) as count FROM logs GROUP BY level_label ORDER BY count DESC' },
  { label: 'Errors only', sql: "SELECT time, msg, data FROM logs WHERE level >= 50 ORDER BY time DESC LIMIT 100" },
  { label: 'JSON field', sql: "SELECT msg, json_extract(data, '$.key') as value FROM logs WHERE json_extract(data, '$.key') IS NOT NULL LIMIT 100" },
  { label: 'By namespace', sql: 'SELECT namespace, COUNT(*) as count FROM logs WHERE namespace IS NOT NULL GROUP BY namespace ORDER BY count DESC' },
  { label: 'Recent 1h', sql: "SELECT * FROM logs WHERE time > (strftime('%s','now') * 1000 - 3600000) ORDER BY time DESC LIMIT 100" },
];

const SCHEMA_INFO = [
  { column: 'id', type: 'TEXT', description: 'Unique log ID' },
  { column: 'level', type: 'INTEGER', description: 'Numeric level (10-60)' },
  { column: 'level_label', type: 'TEXT', description: 'trace, debug, info, warn, error, fatal' },
  { column: 'time', type: 'INTEGER', description: 'Unix timestamp (ms)' },
  { column: 'msg', type: 'TEXT', description: 'Log message' },
  { column: 'namespace', type: 'TEXT', description: 'Logger namespace' },
  { column: 'channel', type: 'TEXT', description: 'Channel name' },
  { column: 'data', type: 'TEXT (JSON)', description: 'JSON payload - use json_extract(data, \'$.field\')' },
];

export function SqlQueryPanel() {
  const {
    sql,
    setSql,
    result,
    error,
    isExecuting,
    history,
    execute,
    navigateHistory,
    clearResult,
  } = useSqlQuery();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      execute();
    }
    // Arrow up/down for history when at start/end of input
    if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault();
      navigateHistory('up');
    }
    if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      navigateHistory('down');
    }
  }, [execute, navigateHistory]);

  const handleExampleClick = useCallback((exampleSql: string) => {
    setSql(exampleSql);
    textareaRef.current?.focus();
  }, [setSql]);

  return (
    <div className="flex flex-col h-full">
      {/* SQL Editor */}
      <div className="border-b border-border p-3 space-y-2">
        <div className="flex items-start gap-2 max-w-[50%]">
          <div className="flex-1 relative min-h-[160px] max-h-[400px] rounded-md border border-border bg-muted/30 focus-within:ring-2 focus-within:ring-ring overflow-hidden">
            <pre
              ref={preRef}
              className="absolute inset-0 p-3 font-mono text-sm whitespace-pre-wrap break-words overflow-hidden pointer-events-none m-0 sql-editor-backdrop"
              aria-hidden="true"
            >
              <code>
                {sql ? <SqlHighlight code={sql} /> : <span className="text-muted-foreground">SELECT * FROM logs LIMIT 100</span>}
              </code>
            </pre>
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={e => setSql(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              className="relative w-full h-full min-h-[160px] max-h-[400px] p-3 font-mono text-sm resize-y bg-transparent text-transparent caret-current focus:outline-none selection:bg-primary/20"
              placeholder=""
              spellCheck={false}
              style={{ caretColor: 'hsl(var(--foreground))' }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Button
              onClick={() => execute()}
              disabled={isExecuting || !sql.trim()}
              size="sm"
              className="gap-1.5"
            >
              {isExecuting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Run
            </Button>
            {result && (
              <Button
                onClick={clearResult}
                variant="ghost"
                size="sm"
                className="gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Ctrl+Enter to execute</span>
          <span className="text-border">|</span>
          <span>Alt+Up/Down for history</span>
          <span className="text-border">|</span>
          <span>Queries all channels</span>
          {result && (
            <>
              <span className="text-border">|</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {result.executionTimeMs}ms
              </span>
              <span className="text-border">|</span>
              <span>{result.rowCount} row{result.rowCount !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-3 mt-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <pre className="font-mono text-xs whitespace-pre-wrap">{error}</pre>
        </div>
      )}

      {/* Results table */}
      {result && result.columns.length > 0 ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <ScrollArea className="flex-1">
            <div className="min-w-max">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-2 bg-muted/30 w-10">#</th>
                    {result.columns.map(col => (
                      <th
                        key={col}
                        className="text-left text-xs font-medium text-muted-foreground px-3 py-2 bg-muted/30 whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-3 py-1.5 text-xs text-muted-foreground font-mono tabular-nums">{i + 1}</td>
                      {result.columns.map(col => {
                        const val = row[col];
                        const display = val === null
                          ? 'NULL'
                          : typeof val === 'object'
                            ? JSON.stringify(val)
                            : String(val);
                        const isNull = val === null;
                        const isLongText = display.length > 100;
                        return (
                          <td
                            key={col}
                            className={`px-3 py-1.5 font-mono text-xs ${isNull ? 'text-muted-foreground italic' : ''} ${isLongText ? 'max-w-[400px] truncate' : 'whitespace-nowrap'}`}
                            title={isLongText ? display : undefined}
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollArea>
        </div>
      ) : !error ? (
        /* Schema helper when no results yet */
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            {/* Schema */}
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                Table: <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">logs</code>
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-1.5">Column</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-1.5">Type</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-3 py-1.5">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {SCHEMA_INFO.map(col => (
                    <tr key={col.column} className="border-b border-border/50">
                      <td className="px-3 py-1.5 font-mono text-xs">{col.column}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{col.type}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{col.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Example queries */}
            <div>
              <h3 className="text-sm font-medium mb-2">Example Queries</h3>
              <div className="grid gap-1.5">
                {EXAMPLE_QUERIES.map((example, i) => (
                  <button
                    key={i}
                    onClick={() => handleExampleClick(example.sql)}
                    className="text-left px-3 py-2 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <span className="text-xs font-medium">{example.label}</span>
                    <pre className="font-mono text-xs text-muted-foreground mt-0.5 group-hover:text-foreground transition-colors">{example.sql}</pre>
                  </button>
                ))}
              </div>
            </div>

            {/* History */}
            {history.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  Query History
                </h3>
                <div className="grid gap-1">
                  {history.slice(0, 10).map((entry, i) => (
                    <button
                      key={i}
                      onClick={() => handleExampleClick(entry.sql)}
                      className="text-left px-3 py-1.5 rounded-md hover:bg-muted/50 transition-colors flex items-center gap-2"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${entry.success ? 'bg-green-500' : 'bg-destructive'}`} />
                      <pre className="font-mono text-xs text-muted-foreground truncate flex-1">{entry.sql}</pre>
                      {entry.rowCount !== undefined && (
                        <span className="text-xs text-muted-foreground flex-shrink-0">{entry.rowCount} rows</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
}
