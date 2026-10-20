import { describe, it, expect, vi, afterEach } from 'vitest';
import { interceptConsole, stopInterceptConsole } from '../console.js';
import { startNetworkCapture } from '../network.js';

vi.mock('../network.js', () => ({
  startNetworkCapture: vi.fn(),
  stopNetworkCapture: vi.fn(),
}));

describe('console network capture ignores its own endpoint', () => {
  afterEach(() => {
    stopInterceptConsole();
    vi.mocked(startNetworkCapture).mockClear();
  });

  const ignored = () => vi.mocked(startNetworkCapture).mock.calls[0][0].ignoreNetworkUrls;

  it('ignores the default endpoint when none is passed', () => {
    interceptConsole({ captureFetch: true, passthrough: true });
    expect(ignored()).toContain('http://localhost:4000');
  });

  it('keeps user ignore patterns and still adds the endpoint', () => {
    interceptConsole({ captureFetch: true, endpoint: 'http://logs:9000', ignoreNetworkUrls: ['/health'] });
    expect(ignored()).toEqual(['/health', 'http://logs:9000']);
  });
});
