/**
 * Web Vitals capture for Abbacchio (OTLP native)
 *
 * Captures Core Web Vitals and additional metrics using Google's web-vitals library:
 *
 *   - LCP  (Largest Contentful Paint) — loading performance
 *   - INP  (Interaction to Next Paint) — interactivity responsiveness
 *   - CLS  (Cumulative Layout Shift)  — visual stability
 *   - FCP  (First Contentful Paint)    — perceived load speed
 *   - TTFB (Time to First Byte)        — server responsiveness
 */

import type { LogEntry } from './client.js';
import type { MetricRecord } from './client.js';

export interface WebVitalsCaptureOptions {
  /** Capture LCP (Largest Contentful Paint). Defaults to true */
  captureLCP?: boolean;
  /** Capture INP (Interaction to Next Paint). Defaults to true */
  captureINP?: boolean;
  /** Capture CLS (Cumulative Layout Shift). Defaults to true */
  captureCLS?: boolean;
  /** Capture FCP (First Contentful Paint). Defaults to true */
  captureFCP?: boolean;
  /** Capture TTFB (Time to First Byte). Defaults to true */
  captureTTFB?: boolean;
  /** Report as OTLP metrics in addition to log entries. Defaults to true */
  reportAsMetrics?: boolean;
  /** App name for log entries */
  appName?: string;
  /** Include current URL in log entries. Defaults to true */
  includeUrl?: boolean;
  /** Log level for good vitals. Defaults to 30 (info) */
  goodLevel?: number;
  /** Log level for needs-improvement vitals. Defaults to 40 (warn) */
  needsImprovementLevel?: number;
  /** Log level for poor vitals. Defaults to 50 (error) */
  poorLevel?: number;
}

type Rating = 'good' | 'needs-improvement' | 'poor';

interface VitalThresholds {
  good: number;
  needsImprovement: number;
  unit: string;
  description: string;
}

const VITAL_THRESHOLDS: Record<string, VitalThresholds> = {
  LCP:  { good: 2500, needsImprovement: 4000, unit: 'ms', description: 'Largest Contentful Paint' },
  INP:  { good: 200,  needsImprovement: 500,  unit: 'ms', description: 'Interaction to Next Paint' },
  CLS:  { good: 0.1,  needsImprovement: 0.25, unit: '',   description: 'Cumulative Layout Shift' },
  FCP:  { good: 1800, needsImprovement: 3000, unit: 'ms', description: 'First Contentful Paint' },
  TTFB: { good: 800,  needsImprovement: 1800, unit: 'ms', description: 'Time to First Byte' },
};

function ratingLevel(rating: Rating, options: WebVitalsCaptureOptions): number {
  if (rating === 'good') return options.goodLevel ?? 30;
  if (rating === 'needs-improvement') return options.needsImprovementLevel ?? 40;
  return options.poorLevel ?? 50;
}

function formatValue(name: string, value: number): string {
  if (name === 'CLS') return value.toFixed(3);
  return `${value.toFixed(0)}ms`;
}

function buildLogEntry(
  name: string,
  value: number,
  rating: Rating,
  id: string,
  navigationType: string,
  entries: PerformanceEntry[],
  options: WebVitalsCaptureOptions,
): LogEntry {
  const thresholds = VITAL_THRESHOLDS[name];
  const level = ratingLevel(rating, options);
  const formatted = formatValue(name, value);

  const entry: LogEntry = {
    level,
    time: Date.now(),
    msg: `${name} ${formatted} (${rating})`,
    name: options.appName || 'browser',
    source: `webvitals.${name.toLowerCase()}`,
    vital: {
      name,
      value,
      rating,
      id,
      navigationType,
      description: thresholds?.description,
    },
  };

  if (name === 'LCP' && entries.length > 0) {
    const lcpEntry = entries[entries.length - 1] as PerformanceEntry & { element?: Element };
    if (lcpEntry.element) {
      (entry.vital as Record<string, unknown>).element = lcpEntry.element.tagName?.toLowerCase();
      if ((lcpEntry.element as HTMLElement).id) {
        (entry.vital as Record<string, unknown>).elementId = (lcpEntry.element as HTMLElement).id;
      }
    }
  }

  if (options.includeUrl !== false && typeof window !== 'undefined') {
    entry.url = window.location.href;
  }

  return entry;
}

function buildMetricRecord(name: string, value: number, rating: Rating): MetricRecord {
  return {
    name: `web_vital.${name.toLowerCase()}`,
    description: VITAL_THRESHOLDS[name]?.description,
    unit: VITAL_THRESHOLDS[name]?.unit || '',
    type: 'gauge',
    value,
    attributes: { rating, vital_name: name },
  };
}

let active = false;

export async function startWebVitalsCapture(
  options: WebVitalsCaptureOptions,
  onLogEntry: (entry: LogEntry) => void,
  onMetricEntry?: (metric: MetricRecord) => void,
): Promise<void> {
  if (typeof window === 'undefined') return;
  stopWebVitalsCapture();

  active = true;

  const { onLCP, onINP, onCLS, onFCP, onTTFB } = await import('web-vitals');

  const reportAsMetrics = options.reportAsMetrics !== false;

  function handleVital(metric: { name: string; value: number; rating: Rating; id: string; navigationType: string; entries: PerformanceEntry[] }) {
    if (!active) return;
    try {
      const logEntry = buildLogEntry(
        metric.name, metric.value, metric.rating,
        metric.id, metric.navigationType, metric.entries, options,
      );
      onLogEntry(logEntry);

      if (reportAsMetrics && onMetricEntry) {
        onMetricEntry(buildMetricRecord(metric.name, metric.value, metric.rating));
      }
    } catch { /* never throw */ }
  }

  const reportOpts = { reportAllChanges: true };

  if (options.captureLCP !== false) onLCP(handleVital, reportOpts);
  if (options.captureINP !== false) onINP(handleVital, reportOpts);
  if (options.captureCLS !== false) onCLS(handleVital, reportOpts);
  if (options.captureFCP !== false) onFCP(handleVital, reportOpts);
  if (options.captureTTFB !== false) onTTFB(handleVital, reportOpts);
}

export function stopWebVitalsCapture(): void {
  active = false;
}
