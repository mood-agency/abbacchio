import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MemoryProfiler,
  collectMemoryProfilerSample,
  installMemoryProfiler,
  serializeMemoryProfilerSamples,
  toMemoryProfilerMetrics,
  type MemoryProfilerSample,
} from '../memory-profiler.js';

describe('memory profiler', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <canvas></canvas>
        <img alt="" />
        <div class="application-row"></div>
      </main>
    `;
  });

  afterEach(() => {
    const api = (globalThis as typeof globalThis & {
      __testMemory?: { dispose(): void };
    }).__testMemory;
    api?.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('collects heap, generic DOM, custom selectors, and copied values', () => {
    const source = { nested: { frames: 2 } };
    const sample = collectMemoryProfilerSample(3, 500, 'mark', 'browser-open', 1_500, {
      domSelectors: { rows: '.application-row' },
      collectValues: () => source,
    });
    source.nested.frames = 99;

    expect(sample).toMatchObject({
      schemaVersion: 2,
      sequence: 3,
      elapsedMs: 1_000,
      kind: 'mark',
      label: 'browser-open',
      dom: { canvases: 1, images: 1, rows: 1 },
      values: { nested: { frames: 2 } },
    });
    expect(sample.heap).toEqual({
      usedBytes: expect.toSatisfy((value) => value === null || typeof value === 'number'),
      totalBytes: expect.toSatisfy((value) => value === null || typeof value === 'number'),
      limitBytes: expect.toSatisfy((value) => value === null || typeof value === 'number'),
    });
  });

  it('bounds retained samples and returns defensive copies', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
    const profiler = new MemoryProfiler({
      collectValues: () => ({ browserPanel: { framesReceived: 1 } }),
    });

    profiler.start({ intervalMs: 1_000, maxSamples: 2 });
    vi.advanceTimersByTime(3_000);

    const firstRead = profiler.getSamples();
    firstRead[0]!.dom.canvases = 999;
    (
      firstRead[0]!.values.browserPanel as { framesReceived: number }
    ).framesReceived = 999;

    const secondRead = profiler.getSamples();
    expect(secondRead[0]!.dom.canvases).toBe(1);
    expect(secondRead[0]!.values.browserPanel).toEqual({ framesReceived: 1 });
    expect(secondRead.map((sample) => sample.sequence)).toEqual([2, 3]);
  });

  it('serializes one JSON object per line', () => {
    const sample = collectMemoryProfilerSample(0, 1_000, 'sample', 'start', 1_000);
    const serialized = serializeMemoryProfilerSamples([sample, { ...sample, sequence: 1 }]);
    const lines = serialized
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.sequence)).toEqual([0, 1]);
    expect(serializeMemoryProfilerSamples([])).toBe('');
  });

  it('shares one session id across a run and starts a new one per run', () => {
    vi.useFakeTimers();
    const profiler = new MemoryProfiler();

    const firstRun = profiler.start({ intervalMs: 1_000 });
    vi.advanceTimersByTime(2_000);
    const firstSamples = profiler.getSamples();
    profiler.stop();

    expect(firstRun.sessionId).toMatch(/\S/);
    expect(new Set(firstSamples.map((sample) => sample.sessionId))).toEqual(
      new Set([firstRun.sessionId]),
    );

    const secondRun = profiler.start({ intervalMs: 1_000 });
    expect(secondRun.sessionId).not.toBe(firstRun.sessionId);
    expect(profiler.getSamples()[0]!.sessionId).toBe(secondRun.sessionId);
  });

  it('forwards every sample to the sink and keeps running when the sink throws', () => {
    vi.useFakeTimers();
    const forwarded: MemoryProfilerSample[] = [];
    const onSample = vi.fn((sample: MemoryProfilerSample) => {
      forwarded.push(sample);
      throw new Error('sink unavailable');
    });
    const profiler = new MemoryProfiler({ onSample });

    profiler.start({ intervalMs: 1_000 });
    vi.advanceTimersByTime(2_000);
    profiler.mark('thread-open');

    // start + 2 interval ticks + 1 mark, none lost to the throwing sink.
    expect(onSample).toHaveBeenCalledTimes(4);
    expect(profiler.getSamples()).toHaveLength(4);
    expect(forwarded.at(-1)).toMatchObject({ kind: 'mark', label: 'thread-open' });

    // The sink receives an isolated copy.
    forwarded[0]!.dom.canvases = 999;
    expect(profiler.getSamples()[0]!.dom.canvases).toBe(1);
  });

  it('converts a sample into attributed gauge points', () => {
    const sample: MemoryProfilerSample = {
      schemaVersion: 2,
      sessionId: 'run-1',
      sequence: 7,
      timestamp: '2026-07-24T12:00:00.000Z',
      elapsedMs: 1_000,
      kind: 'mark',
      label: 'browser-open',
      heap: { usedBytes: 10, totalBytes: 20, limitBytes: null },
      dom: { elements: 5, canvases: 1, images: 2, monacoEditors: 3 },
      values: {
        browserPanel: {
          totals: { framesReceived: 4, payloadBase64Chars: 8, lastFrameAt: null },
          trackedSessions: [{ sessionId: 'a', framesReceived: 4 }],
          streaming: true,
        },
      },
    };

    const metrics = toMemoryProfilerMetrics(sample, {
      prefix: 'client.memory',
      attributes: { service: 'funny' },
    });
    const byName = Object.fromEntries(metrics.map((point) => [point.name, point.value]));

    expect(byName).toEqual({
      'client.memory.heap.used_bytes': 10,
      'client.memory.heap.total_bytes': 20,
      'client.memory.dom.elements': 5,
      'client.memory.dom.canvases': 1,
      'client.memory.dom.images': 2,
      'client.memory.dom.monaco_editors': 3,
      'client.memory.browser_panel.totals.frames_received': 4,
      'client.memory.browser_panel.totals.payload_base64_chars': 8,
      'client.memory.browser_panel.streaming': 1,
    });
    expect(metrics[0]!.attributes).toEqual({
      service: 'funny',
      sessionId: 'run-1',
      kind: 'mark',
      sequence: '7',
      label: 'browser-open',
    });
  });

  it('omits the label attribute for unlabeled samples and defaults the prefix', () => {
    const sample = collectMemoryProfilerSample(0, 0, 'sample', null, 0, {
      sessionId: 'run-2',
    });
    const metrics = toMemoryProfilerMetrics(sample);

    expect(metrics.every((point) => point.name.startsWith('browser.memory.'))).toBe(true);
    expect(metrics[0]!.attributes).not.toHaveProperty('label');
    expect(metrics[0]!.attributes.sessionId).toBe('run-2');
  });

  it('installs a stopped configurable global and disposes prior and HMR instances', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    let disposeForHmr: (() => void) | undefined;
    const hot = { dispose: (callback: () => void) => (disposeForHmr = callback) };
    const first = installMemoryProfiler({ globalName: '__testMemory', hot });
    const firstDispose = vi.spyOn(first, 'dispose');

    expect(first.status()).toMatchObject({ running: false, retainedSamples: 0 });

    const second = installMemoryProfiler({ globalName: '__testMemory', hot });
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(
      (globalThis as typeof globalThis & { __testMemory?: unknown }).__testMemory,
    ).toBe(second);

    disposeForHmr?.();
    expect(
      (globalThis as typeof globalThis & { __testMemory?: unknown }).__testMemory,
    ).toBeUndefined();
    expect(info).toHaveBeenCalledTimes(2);
  });
});
