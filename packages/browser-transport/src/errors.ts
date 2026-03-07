/**
 * Global error capture for Abbacchio (OTLP native)
 * Captures uncaught exceptions and unhandled promise rejections
 */

import type { LogEntry } from './client.js';

export interface ErrorCaptureOptions {
  /** Capture uncaught exceptions via window 'error' event. Defaults to false */
  captureErrors?: boolean;
  /** Capture unhandled promise rejections. Defaults to false */
  captureUnhandledRejections?: boolean;
  /** App name for log entries */
  appName?: string;
  /** Include current URL in error log entries. Defaults to true */
  includeUrl?: boolean;
  /** Include user agent in error log entries. Defaults to false */
  includeUserAgent?: boolean;
}

let errorHandler: ((event: ErrorEvent) => void) | null = null;
let rejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;

function createErrorEntry(event: ErrorEvent, options: ErrorCaptureOptions): LogEntry {
  const entry: LogEntry = {
    level: 60,
    time: Date.now(),
    msg: event.error?.message || event.message || 'Uncaught error',
    name: options.appName || 'browser',
    source: 'uncaughtException',
    error: {
      name: event.error?.name || 'Error',
      message: event.error?.message || event.message,
      stack: event.error?.stack || undefined,
    },
  };

  if (event.filename) {
    entry.caller = {
      file: event.filename,
      line: event.lineno,
      column: event.colno,
    };
  }

  if (options.includeUrl !== false && typeof window !== 'undefined') {
    entry.url = window.location.href;
  }

  if (options.includeUserAgent && typeof navigator !== 'undefined') {
    entry.userAgent = navigator.userAgent;
  }

  return entry;
}

function createRejectionEntry(event: PromiseRejectionEvent, options: ErrorCaptureOptions): LogEntry {
  const reason = event.reason;
  let msg: string;
  let errorInfo: Record<string, unknown> | undefined;

  if (reason instanceof Error) {
    msg = reason.message || 'Unhandled promise rejection';
    errorInfo = { name: reason.name, message: reason.message, stack: reason.stack };
  } else if (typeof reason === 'string') {
    msg = reason;
  } else {
    try { msg = JSON.stringify(reason); } catch { msg = 'Unhandled promise rejection'; }
  }

  const entry: LogEntry = {
    level: 50,
    time: Date.now(),
    msg,
    name: options.appName || 'browser',
    source: 'unhandledRejection',
  };

  if (errorInfo) entry.error = errorInfo;

  if (options.includeUrl !== false && typeof window !== 'undefined') {
    entry.url = window.location.href;
  }

  if (options.includeUserAgent && typeof navigator !== 'undefined') {
    entry.userAgent = navigator.userAgent;
  }

  return entry;
}

export function startErrorCapture(
  options: ErrorCaptureOptions,
  onEntry: (entry: LogEntry) => void,
): void {
  if (typeof window === 'undefined') return;
  stopErrorCapture();

  if (options.captureErrors) {
    errorHandler = (event: ErrorEvent) => {
      try { onEntry(createErrorEntry(event, options)); } catch { /* never throw */ }
    };
    window.addEventListener('error', errorHandler);
  }

  if (options.captureUnhandledRejections) {
    rejectionHandler = (event: PromiseRejectionEvent) => {
      try { onEntry(createRejectionEntry(event, options)); } catch { /* never throw */ }
    };
    window.addEventListener('unhandledrejection', rejectionHandler);
  }
}

export function stopErrorCapture(): void {
  if (typeof window === 'undefined') return;

  if (errorHandler) {
    window.removeEventListener('error', errorHandler);
    errorHandler = null;
  }

  if (rejectionHandler) {
    window.removeEventListener('unhandledrejection', rejectionHandler);
    rejectionHandler = null;
  }
}
