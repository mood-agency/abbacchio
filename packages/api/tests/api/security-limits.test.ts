import { describe, it, expect, afterEach } from 'bun:test';
import { LogDatabase } from '../../src/lib/database.js';
import { LogBuffer } from '../../src/lib/log-buffer.js';
import { createTestApp } from '../helpers/test-app.js';

describe('executeSql on a shared :memory: connection', () => {
  let db: LogDatabase;
  afterEach(() => db.close());

  it('refuses writes hidden behind a CTE and leaves the data intact', () => {
    db = new LogDatabase({ path: ':memory:', ttlMs: 0 });
    db.insert(new LogBuffer().add({ level: 30, msg: 'keep me' }));
    db.flush();

    expect(() => db.executeSql('WITH x AS (SELECT 1 LIMIT 1) DELETE FROM logs')).toThrow();

    expect(db.executeSql('SELECT msg FROM logs').rows).toEqual([{ msg: 'keep me' }]);
    // The connection must be writable again afterwards.
    db.insert(new LogBuffer().add({ level: 30, msg: 'still writable' }));
    db.flush();
    expect(db.executeSql('SELECT COUNT(*) AS n FROM logs').rows).toEqual([{ n: 2 }]);
  });
});

describe('GET /api/stream connection cap', () => {
  const original = process.env.MAX_SSE_CONNECTIONS;
  afterEach(() => {
    if (original === undefined) delete process.env.MAX_SSE_CONNECTIONS;
    else process.env.MAX_SSE_CONNECTIONS = original;
  });

  it('rejects streams beyond MAX_SSE_CONNECTIONS and frees slots on disconnect', async () => {
    process.env.MAX_SSE_CONNECTIONS = '2';
    const app = createTestApp();

    const a = await app.request('/api/stream');
    const b = await app.request('/api/stream');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const rejected = await app.request('/api/stream');
    expect(rejected.status).toBe(503);

    await a.body!.cancel();
    // onAbort runs asynchronously after the cancel propagates.
    let next: Response | undefined;
    for (let i = 0; i < 50; i++) {
      await Bun.sleep(10);
      next = await app.request('/api/stream');
      if (next.status === 200) break;
    }
    expect(next!.status).toBe(200);

    await b.body!.cancel();
    await next!.body!.cancel();
  });
});
