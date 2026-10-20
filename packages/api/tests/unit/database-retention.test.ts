import { describe, it, expect, afterEach } from 'bun:test';
import { LogDatabase } from '../../src/lib/database.js';
import { LogBuffer } from '../../src/lib/log-buffer.js';
import type { TraceSpan } from '../../src/types.js';

// pruneIfNeeded normally runs on a 30s timer; call it directly.
function prune(db: LogDatabase): void {
  (db as unknown as { pruneIfNeeded(): void }).pruneIfNeeded();
}

function span(i: number): TraceSpan {
  return {
    traceId: `trace-${i}`,
    spanId: `span-${i}`,
    name: `op-${i}`,
    startTimeMs: 1000 + i,
    endTimeMs: 2000 + i,
    channel: 'svc',
    attributes: {},
  };
}

describe('LogDatabase retention', () => {
  let db: LogDatabase;

  afterEach(() => db.close());

  it('queryAfterId resumes from the oldest surviving log when the cursor was pruned', () => {
    db = new LogDatabase({ path: process.env.SQLITE_PATH, maxLogs: 2, ttlMs: 0 });
    const buffer = new LogBuffer();
    const entries = [1, 2, 3, 4].map((i) => buffer.add({ level: 30, msg: `Log ${i}` }));
    db.insertBatch(entries);
    db.flush();

    prune(db); // keeps only Log 3 and Log 4
    expect(db.queryById(entries[0].id)).toBeNull();

    const logs = db.queryAfterId(entries[0].id);
    expect(logs.map((l) => l.msg).sort()).toEqual(['Log 3', 'Log 4']);
  });

  it('caps the traces table by count like logs and metrics', () => {
    db = new LogDatabase({ path: process.env.SQLITE_PATH, maxLogs: 2, ttlMs: 0 });
    db.queueSpanBatch([1, 2, 3, 4].map(span));
    db.flush();

    prune(db);

    const result = db.queryTraces({ order: 'asc' });
    expect(result.spans.map((s) => s.spanId)).toEqual(['span-3', 'span-4']);
  });
});
