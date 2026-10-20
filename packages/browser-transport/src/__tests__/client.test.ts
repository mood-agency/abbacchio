import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AbbacchioClient } from '../client.js';

describe('AbbacchioClient delivery', () => {
  let calls: { url: string; init: RequestInit }[];
  let nextStatus: number;

  beforeEach(() => {
    calls = [];
    nextStatus = 200;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: nextStatus, headers: nextStatus === 429 ? { 'Retry-After': '60' } : {} });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const logMsgs = (i: number) =>
    JSON.parse(calls[i].init.body as string).resourceLogs[0].scopeLogs[0].logRecords.map(
      (r: { body: { stringValue: string } }) => r.body.stringValue,
    );

  it('re-sends a rate-limited batch on close instead of dropping it', async () => {
    const client = new AbbacchioClient({ endpoint: 'http://test:4002', maxPointsPerSecond: 0 });

    nextStatus = 429;
    client.add({ level: 30, msg: 'first' });
    await client.flush();
    expect(calls).toHaveLength(1);

    nextStatus = 200;
    client.add({ level: 30, msg: 'second' });
    await client.close();

    expect(calls).toHaveLength(2);
    expect(logMsgs(1)).toEqual(['first', 'second']);
  });

  it('flushes with keepalive on pagehide, even while paused by a 429', async () => {
    const client = new AbbacchioClient({ endpoint: 'http://test:4002', maxPointsPerSecond: 0 });

    nextStatus = 429;
    client.add({ level: 30, msg: 'before unload' });
    await client.flush();

    nextStatus = 200;
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    expect(calls[1].init.keepalive).toBe(true);
    expect(logMsgs(1)).toEqual(['before unload']);
    await client.close();
  });

  it('removes its unload listeners on close', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const client = new AbbacchioClient({ endpoint: 'http://test:4002' });
    await client.close();

    const removed = remove.mock.calls.map(([type]) => type);
    expect(removed).toContain('beforeunload');
    expect(removed).toContain('pagehide');

    // A closed client must not flush on a later unload.
    window.dispatchEvent(new Event('pagehide'));
    expect(calls).toHaveLength(0);
  });
});
