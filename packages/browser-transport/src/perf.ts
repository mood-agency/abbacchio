/**
 * Performance capture for Abbacchio (OTLP native)
 *
 * Captures main-thread jank that Chrome reports as `[Violation]` in DevTools
 * but does NOT expose via console.* — specifically:
 *
 *   - PerformanceObserver `longtask` entries (tasks > 50ms blocking the main thread)
 *   - PerformanceObserver `event` entries (slow input/message handlers via Event Timing API)
 *
 * These are the standards-based equivalents of the DevTools `[Violation]`
 * warnings (`'message' handler took <N>ms`, `'requestAnimationFrame' handler took <N>ms`, etc.).
 */

import type { LogEntry } from './client.js';

export interface PerfCaptureOptions {
  /** Capture long tasks (>50ms) via PerformanceObserver. Defaults to false */
  captureLongTasks?: boolean;
  /** Capture slow events (click, message, etc.) via Event Timing API. Defaults to false */
  captureSlowEvents?: boolean;
  /** Duration threshold in ms for slow events. Defaults to 50 */
  slowEventThresholdMs?: number;
  /** Log level for longtask entries. Defaults to 40 (warn) */
  longTaskLevel?: number;
  /** Log level for slow event entries. Defaults to 40 (warn) */
  slowEventLevel?: number;
  /** App name for log entries */
  appName?: string;
  /** Include current URL in log entries. Defaults to true */
  includeUrl?: boolean;
}

interface LongTaskAttribution {
  name?: string;
  entryType?: string;
  containerType?: string;
  containerName?: string;
  containerId?: string;
  containerSrc?: string;
}

interface LongTaskEntry extends PerformanceEntry {
  attribution?: LongTaskAttribution[];
}

interface EventTimingEntry extends PerformanceEntry {
  processingStart?: number;
  processingEnd?: number;
  cancelable?: boolean;
  target?: Element | null;
}

let longTaskObserver: PerformanceObserver | null = null;
let eventObserver: PerformanceObserver | null = null;

function baseEntry(options: PerfCaptureOptions, level: number, msg: string, source: string): LogEntry {
  const entry: LogEntry = {
    level,
    time: Date.now(),
    msg,
    name: options.appName || 'browser',
    source,
  };

  if (options.includeUrl !== false && typeof window !== 'undefined') {
    entry.url = window.location.href;
  }

  return entry;
}

export function startPerfCapture(
  options: PerfCaptureOptions,
  onEntry: (entry: LogEntry) => void,
): void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  stopPerfCapture();

  const supported = PerformanceObserver.supportedEntryTypes || [];

  if (options.captureLongTasks && supported.includes('longtask')) {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as LongTaskEntry[]) {
          try {
            const log = baseEntry(
              options,
              options.longTaskLevel ?? 40,
              `longtask ${entry.duration.toFixed(1)}ms`,
              'perf.longtask',
            );
            log.duration = entry.duration;
            log.startTime = entry.startTime;
            log.entryType = entry.entryType;
            if (entry.attribution && entry.attribution.length > 0) {
              log.attribution = entry.attribution.map((a) => ({
                name: a.name,
                entryType: a.entryType,
                containerType: a.containerType,
                containerName: a.containerName,
                containerId: a.containerId,
                containerSrc: a.containerSrc,
              }));
            }
            onEntry(log);
          } catch { /* never throw */ }
        }
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch { /* ignore */ }
  }

  if (options.captureSlowEvents && supported.includes('event')) {
    try {
      eventObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as EventTimingEntry[]) {
          try {
            const log = baseEntry(
              options,
              options.slowEventLevel ?? 40,
              `slow '${entry.name}' handler ${entry.duration.toFixed(1)}ms`,
              'perf.event',
            );
            log.duration = entry.duration;
            log.eventName = entry.name;
            log.startTime = entry.startTime;
            if (entry.processingStart !== undefined) log.processingStart = entry.processingStart;
            if (entry.processingEnd !== undefined) log.processingEnd = entry.processingEnd;
            if (entry.cancelable !== undefined) log.cancelable = entry.cancelable;
            if (entry.target?.tagName) {
              log.target = `${entry.target.tagName.toLowerCase()}${entry.target.id ? '#' + entry.target.id : ''}`;
            }
            onEntry(log);
          } catch { /* never throw */ }
        }
      });
      eventObserver.observe({
        type: 'event',
        buffered: true,
        durationThreshold: options.slowEventThresholdMs ?? 50,
      } as PerformanceObserverInit & { durationThreshold: number });
    } catch { /* ignore */ }
  }
}

export function stopPerfCapture(): void {
  if (longTaskObserver) {
    try { longTaskObserver.disconnect(); } catch { /* ignore */ }
    longTaskObserver = null;
  }
  if (eventObserver) {
    try { eventObserver.disconnect(); } catch { /* ignore */ }
    eventObserver = null;
  }
}
