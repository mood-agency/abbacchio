import { describe, it, expect } from 'bun:test';
import { TraceBuffer } from '../../src/lib/trace-buffer.js';
import { MetricBuffer } from '../../src/lib/metric-buffer.js';
import type { MetricDataPoint, TraceSpan } from '../../src/types.js';

function span(channel: string): TraceSpan {
  return { traceId: 't', spanId: channel, name: 'op', startTimeMs: 0, endTimeMs: 1, channel, attributes: {} };
}

function metric(channel: string): MetricDataPoint {
  return { name: 'm', type: 'Gauge', channel, timeUnixNano: 0, value: 1, attributes: {} };
}

describe('TraceBuffer channel cap', () => {
  it('evicts the least recently written channel at maxChannels', () => {
    const buffer = new TraceBuffer({ maxChannels: 2 });
    buffer.addBatch([span('a')]);
    buffer.addBatch([span('b')]);
    buffer.addBatch([span('a')]); // touch a, so b is now the oldest
    buffer.addBatch([span('c')]);

    expect(buffer.getChannels().sort()).toEqual(['a', 'c']);
  });

  it('handles a single batch spanning more channels than the cap', () => {
    const buffer = new TraceBuffer({ maxChannels: 1 });
    expect(() => buffer.addBatch([span('a'), span('b'), span('c')])).not.toThrow();
    expect(buffer.getChannels()).toEqual(['c']);
  });
});

describe('MetricBuffer channel cap', () => {
  it('evicts the least recently written channel at maxChannels', () => {
    const buffer = new MetricBuffer({ maxChannels: 2 });
    buffer.addBatch([metric('a')]);
    buffer.addBatch([metric('b')]);
    buffer.addBatch([metric('a')]);
    buffer.addBatch([metric('c')]);

    expect(buffer.getChannels().sort()).toEqual(['a', 'c']);
  });

  it('handles a single batch spanning more channels than the cap', () => {
    const buffer = new MetricBuffer({ maxChannels: 1 });
    expect(() => buffer.addBatch([metric('a'), metric('b'), metric('c')])).not.toThrow();
    expect(buffer.getChannels()).toEqual(['c']);
  });
});
