import type { ReactNode } from 'react';
import { Highlight, themes } from 'prism-react-renderer';

interface CodeBlockProps {
  code: string;
  language: 'javascript' | 'bash' | 'typescript' | 'json' | 'python';
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  // prism-react-renderer doesn't support bash well, so we render it as plain text with custom styling
  if (language === 'bash') {
    return (
      <pre
        className="text-xs rounded p-3 overflow-x-auto"
        style={{
          background: 'rgb(1, 22, 39)',
          color: 'rgb(214, 222, 235)',
          margin: 0,
        }}
      >
        <code>{highlightBash(code)}</code>
      </pre>
    );
  }

  return (
    <Highlight theme={themes.nightOwl} code={code} language={language}>
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className="text-xs rounded p-3 overflow-x-auto"
          style={{ ...style, margin: 0 }}
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

// Simple bash syntax highlighter
function highlightBash(code: string): ReactNode {
  const lines = code.split('\n');

  return lines.map((line, i) => {
    const parts: ReactNode[] = [];
    let remaining = line;
    let key = 0;

    // Highlight strings (double and single quotes)
    const stringRegex = /("[^"]*"|'[^']*')/g;
    let match;
    let lastIndex = 0;

    while ((match = stringRegex.exec(remaining)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        parts.push(
          <span key={key++}>
            {highlightBashTokens(remaining.slice(lastIndex, match.index))}
          </span>
        );
      }
      // Add the string
      parts.push(
        <span key={key++} style={{ color: 'rgb(173, 219, 103)' }}>
          {match[0]}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < remaining.length) {
      parts.push(
        <span key={key++}>
          {highlightBashTokens(remaining.slice(lastIndex))}
        </span>
      );
    }

    return (
      <div key={i}>
        {parts.length > 0 ? parts : highlightBashTokens(line)}
      </div>
    );
  });
}

function highlightBashTokens(text: string): ReactNode {
  // Highlight commands and flags
  const tokens = text.split(/(\s+)/);
  return tokens.map((token, i) => {
    // Flags like -X, -H, -d
    if (/^-[a-zA-Z]/.test(token)) {
      return <span key={i} style={{ color: 'rgb(127, 219, 202)' }}>{token}</span>;
    }
    // Commands like curl, npm
    if (/^(curl|npm|install|pnpm|yarn)$/.test(token)) {
      return <span key={i} style={{ color: 'rgb(130, 170, 255)' }}>{token}</span>;
    }
    // URLs
    if (token.includes('http://') || token.includes('https://')) {
      return <span key={i} style={{ color: 'rgb(255, 203, 139)' }}>{token}</span>;
    }
    return <span key={i}>{token}</span>;
  });
}
