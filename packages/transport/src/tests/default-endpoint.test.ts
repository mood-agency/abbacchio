import { describe, it, expect, mock } from 'bun:test';
import { createClient } from '../index.js';

describe('default endpoint', () => {
  it('sends to the API on its default port (4000) when no endpoint is given', async () => {
    const urls: string[] = [];
    // @ts-expect-error — mock global fetch
    globalThis.fetch = mock(async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 200 });
    });

    const client = createClient({ batchSize: 1, maxPointsPerSecond: 0 });
    client.add({ level: 30, msg: 'hello' });
    await client.close();

    expect(urls).toEqual(['http://localhost:4000/v1/logs']);
  });
});
