import { describe, it, expect } from 'bun:test';
import { appendLogs } from '../src/lib/log-window';
import type { LogEntry } from '../src/types';

const log = (id: number): LogEntry =>
  ({ id: String(id), level: 30, levelLabel: 'info', time: id, msg: `m${id}`, channel: 'c', data: {} }) as LogEntry;
const ids = (logs: LogEntry[]) => logs.map((l) => Number(l.id));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => log(from + i));

describe('appendLogs', () => {
  it('appends new logs and skips ids already held', () => {
    const r = appendLogs(range(1, 3), [log(3), log(4), log(4), log(5)]);
    expect(ids(r.logs)).toEqual([1, 2, 3, 4, 5]);
    expect(r.added).toBe(2);
    expect(r.trimmed).toBe(false);
  });

  it('returns the same array when nothing is new (no re-render)', () => {
    const prev = range(1, 3);
    expect(appendLogs(prev, [log(2)]).logs).toBe(prev);
  });

  it('drops the oldest logs beyond the cap and reports it', () => {
    const r = appendLogs(range(1, 5), range(6, 8), 5);
    expect(ids(r.logs)).toEqual([4, 5, 6, 7, 8]);
    expect(r.trimmed).toBe(true);
  });

  it('keeps logs that streamed in during an initial load, after the loaded page', () => {
    // Initial load returned 1..3 while SSE already delivered 3 and 4.
    const r = appendLogs(range(1, 3), [log(3), log(4)]);
    expect(ids(r.logs)).toEqual([1, 2, 3, 4]);
  });
});
