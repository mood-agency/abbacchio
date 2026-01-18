#!/usr/bin/env node
import meow from 'meow';
import { LOG_LEVEL_NAMES } from './types/index.js';
import type { LogLevelLabel, CLIOptions } from './types/index.js';

const cli = meow(`
  Usage
    $ abbacchio --channel <channel>

  Options
    --channel, -c    Channel name (required)
    --api-url, -u    API URL (default: http://localhost:4000)
    --key, -k        Decryption key for encrypted logs
    --level, -l      Minimum log level (trace|debug|info|warn|error|fatal)
    --help           Show this help message
    --version        Show version number

  Examples
    $ abbacchio -c my-app
    $ abbacchio -c production -u https://logs.example.com -l warn
    $ abbacchio -c encrypted-channel -k mysecretkey

  Keyboard Shortcuts
    q          Quit
    p / Space  Pause/Resume
    j/k or arrows  Scroll
    g/G        Go to top/bottom
    /          Search
    1-6        Filter by level (trace-fatal)
    0          Show all levels
    c          Clear logs
    ?          Show help
`, {
  importMeta: import.meta,
  flags: {
    channel: {
      type: 'string',
      shortFlag: 'c',
    },
    apiUrl: {
      type: 'string',
      shortFlag: 'u',
      default: 'http://localhost:4000',
    },
    key: {
      type: 'string',
      shortFlag: 'k',
    },
    level: {
      type: 'string',
      shortFlag: 'l',
    },
  },
});

// Validate required options
if (!cli.flags.channel) {
  console.error('Error: --channel is required\n');
  cli.showHelp();
  process.exit(1);
}

// Validate level if provided
if (cli.flags.level) {
  const validLevels: LogLevelLabel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  if (!validLevels.includes(cli.flags.level as LogLevelLabel)) {
    console.error(`Error: Invalid level "${cli.flags.level}". Must be one of: ${validLevels.join(', ')}\n`);
    process.exit(1);
  }
}

const options: CLIOptions = {
  channel: cli.flags.channel,
  apiUrl: cli.flags.apiUrl,
  key: cli.flags.key,
  level: cli.flags.level as LogLevelLabel | undefined,
};

// Dynamically import and run the app
async function run() {
  const { renderApp } = await import('./index.js');
  renderApp(options);
}

run().catch(err => {
  console.error('Failed to start TUI:', err);
  process.exit(1);
});
