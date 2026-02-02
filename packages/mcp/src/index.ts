#!/usr/bin/env node
/**
 * Abbacchio MCP Server
 *
 * Enables Claude Code to search and analyze logs stored by the Abbacchio Tauri app.
 * Reads from ~/.abbacchio/logs.db (shared with Tauri desktop app).
 *
 * Usage in Claude Code settings:
 * {
 *   "mcpServers": {
 *     "abbacchio": {
 *       "command": "npx",
 *       "args": ["@abbacchio/mcp"]
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

// Database path (same as Tauri app)
const DB_PATH = join(homedir(), '.abbacchio', 'logs.db');

// Types
interface LogEntry {
  id: string;
  level: number;
  levelLabel: string;
  time: number;
  msg: string;
  namespace: string | null;
  channel: string;
  data: Record<string, unknown>;
}

interface SearchParams {
  query?: string;
  channel?: string;
  level?: string;
  from?: number;
  to?: number;
  limit?: number;
}

// Database helper
function getDatabase(): Database.Database | null {
  if (!existsSync(DB_PATH)) {
    return null;
  }
  return new Database(DB_PATH, { readonly: true });
}

function rowToLogEntry(row: Record<string, unknown>): LogEntry {
  return {
    id: row.id as string,
    level: row.level as number,
    levelLabel: row.level_label as string,
    time: row.time as number,
    msg: row.msg as string,
    namespace: row.namespace as string | null,
    channel: row.channel as string,
    data: JSON.parse((row.data as string) || '{}'),
  };
}

// Tool definitions
const tools: Tool[] = [
  {
    name: 'search_logs',
    description:
      'Search logs with text query and filters. Use this to find logs matching specific patterns, error messages, or keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text to search for in log messages and data',
        },
        channel: {
          type: 'string',
          description: 'Filter by channel/app name',
        },
        level: {
          type: 'string',
          enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
          description: 'Minimum log level to include',
        },
        from: {
          type: 'number',
          description: 'Start timestamp (Unix ms)',
        },
        to: {
          type: 'number',
          description: 'End timestamp (Unix ms)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 50)',
        },
      },
    },
  },
  {
    name: 'get_recent_errors',
    description:
      'Get recent error and fatal logs. Use this to quickly see what went wrong.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Filter by channel/app name',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 20)',
        },
        minutes: {
          type: 'number',
          description: 'Look back this many minutes (default 60)',
        },
      },
    },
  },
  {
    name: 'get_logs_around_time',
    description:
      'Get logs from all channels around a specific timestamp. Use this to correlate events across services.',
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'number',
          description: 'Center timestamp (Unix ms)',
          required: true,
        },
        window: {
          type: 'number',
          description: 'Time window in ms (default 5000 = 5 seconds)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 100)',
        },
      },
      required: ['timestamp'],
    },
  },
  {
    name: 'get_channels',
    description: 'List all available log channels with their statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_log_stats',
    description: 'Get statistics about stored logs (counts by level, time range, etc).',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Filter by channel/app name',
        },
      },
    },
  },
  {
    name: 'analyze_error',
    description:
      'Given an error message (e.g., pasted from browser console), search for related logs and provide context.',
    inputSchema: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          description: 'The error message to analyze',
          required: true,
        },
        channel: {
          type: 'string',
          description: 'Filter by channel/app name',
        },
      },
      required: ['error'],
    },
  },
];

// Tool handlers
function searchLogs(params: SearchParams): LogEntry[] {
  const db = getDatabase();
  if (!db) return [];

  try {
    let sql = `
      SELECT id, level, level_label, time, msg, namespace, channel, data
      FROM logs WHERE 1=1
    `;
    const sqlParams: unknown[] = [];

    if (params.channel) {
      sql += ' AND channel = ?';
      sqlParams.push(params.channel);
    }

    if (params.level) {
      const levelMap: Record<string, number> = {
        trace: 10,
        debug: 20,
        info: 30,
        warn: 40,
        error: 50,
        fatal: 60,
      };
      sql += ' AND level >= ?';
      sqlParams.push(levelMap[params.level] || 30);
    }

    if (params.from) {
      sql += ' AND time >= ?';
      sqlParams.push(params.from);
    }

    if (params.to) {
      sql += ' AND time <= ?';
      sqlParams.push(params.to);
    }

    if (params.query) {
      sql += ' AND (msg LIKE ? OR data LIKE ?)';
      const pattern = `%${params.query}%`;
      sqlParams.push(pattern, pattern);
    }

    sql += ' ORDER BY time DESC LIMIT ?';
    sqlParams.push(params.limit || 50);

    const stmt = db.prepare(sql);
    const rows = stmt.all(...sqlParams) as Record<string, unknown>[];
    return rows.map(rowToLogEntry);
  } finally {
    db.close();
  }
}

function getRecentErrors(params: {
  channel?: string;
  limit?: number;
  minutes?: number;
}): LogEntry[] {
  const minutes = params.minutes || 60;
  const from = Date.now() - minutes * 60 * 1000;

  return searchLogs({
    channel: params.channel,
    level: 'error',
    from,
    limit: params.limit || 20,
  });
}

function getLogsAroundTime(params: {
  timestamp: number;
  window?: number;
  limit?: number;
}): LogEntry[] {
  const window = params.window || 5000;
  const from = params.timestamp - window;
  const to = params.timestamp + window;

  return searchLogs({
    from,
    to,
    limit: params.limit || 100,
  });
}

function getChannels(): Array<{
  channel: string;
  count: number;
  lastActivity: number;
}> {
  const db = getDatabase();
  if (!db) return [];

  try {
    const stmt = db.prepare(`
      SELECT channel, COUNT(*) as count, MAX(time) as lastActivity
      FROM logs
      GROUP BY channel
      ORDER BY lastActivity DESC
    `);
    return stmt.all() as Array<{
      channel: string;
      count: number;
      lastActivity: number;
    }>;
  } finally {
    db.close();
  }
}

function getLogStats(params: { channel?: string }): {
  total: number;
  byLevel: Record<string, number>;
  timeRange: { min: number | null; max: number | null };
} {
  const db = getDatabase();
  if (!db)
    return { total: 0, byLevel: {}, timeRange: { min: null, max: null } };

  try {
    let countSql = 'SELECT COUNT(*) as count FROM logs';
    let levelSql =
      'SELECT level_label, COUNT(*) as count FROM logs GROUP BY level_label';
    let rangeSql = 'SELECT MIN(time) as min, MAX(time) as max FROM logs';

    const sqlParams: unknown[] = [];
    if (params.channel) {
      const whereClause = ' WHERE channel = ?';
      countSql += whereClause;
      levelSql = `SELECT level_label, COUNT(*) as count FROM logs WHERE channel = ? GROUP BY level_label`;
      rangeSql += whereClause;
      sqlParams.push(params.channel);
    }

    const total = (
      db.prepare(countSql).get(...sqlParams) as { count: number }
    ).count;

    const byLevel: Record<string, number> = {};
    const levelRows = db.prepare(levelSql).all(...sqlParams) as Array<{
      level_label: string;
      count: number;
    }>;
    for (const row of levelRows) {
      byLevel[row.level_label] = row.count;
    }

    const range = db.prepare(rangeSql).get(...sqlParams) as {
      min: number | null;
      max: number | null;
    };

    return { total, byLevel, timeRange: range };
  } finally {
    db.close();
  }
}

function analyzeError(params: { error: string; channel?: string }): {
  relatedLogs: LogEntry[];
  summary: string;
} {
  // Extract potential keywords from the error message
  const keywords = params.error
    .split(/[\s\n:,()[\]{}]+/)
    .filter((word) => word.length > 3)
    .slice(0, 5);

  // Search for logs containing these keywords
  const allRelated: LogEntry[] = [];

  for (const keyword of keywords) {
    const logs = searchLogs({
      query: keyword,
      channel: params.channel,
      limit: 10,
    });
    allRelated.push(...logs);
  }

  // Deduplicate by ID
  const seen = new Set<string>();
  const relatedLogs = allRelated.filter((log) => {
    if (seen.has(log.id)) return false;
    seen.add(log.id);
    return true;
  });

  // Sort by time descending
  relatedLogs.sort((a, b) => b.time - a.time);

  // Generate summary
  const errorCount = relatedLogs.filter((l) => l.level >= 50).length;
  const channels = [...new Set(relatedLogs.map((l) => l.channel))];

  const summary = `Found ${relatedLogs.length} related logs (${errorCount} errors) across ${channels.length} channel(s): ${channels.join(', ')}`;

  return { relatedLogs: relatedLogs.slice(0, 20), summary };
}

// Create server
const server = new Server(
  {
    name: 'abbacchio',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Check if database exists
  if (!existsSync(DB_PATH)) {
    return {
      content: [
        {
          type: 'text',
          text: `Abbacchio database not found at ${DB_PATH}. Please run the Abbacchio Tauri desktop app first to create the database.`,
        },
      ],
    };
  }

  let result: unknown;

  switch (name) {
    case 'search_logs':
      result = searchLogs(args as SearchParams);
      break;
    case 'get_recent_errors':
      result = getRecentErrors(
        args as { channel?: string; limit?: number; minutes?: number }
      );
      break;
    case 'get_logs_around_time':
      result = getLogsAroundTime(
        args as { timestamp: number; window?: number; limit?: number }
      );
      break;
    case 'get_channels':
      result = getChannels();
      break;
    case 'get_log_stats':
      result = getLogStats(args as { channel?: string });
      break;
    case 'analyze_error':
      result = analyzeError(args as { error: string; channel?: string });
      break;
    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Abbacchio MCP server started');
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
