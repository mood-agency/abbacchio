import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { CLIOptions } from './types/index.js';

export function renderApp(options: CLIOptions): void {
  render(<App options={options} />);
}

export type { CLIOptions, LogEntry } from './types/index.js';
