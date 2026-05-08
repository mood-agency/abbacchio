import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startNetworkCapture, stopNetworkCapture, resetForTesting } from '../network.js';
import type { LogEntry } from '../client.js';

describe('Network Capture (Monkey Patching)', () => {
  let logSpy: ReturnType<typeof vi.fn>;
  let nativeFetch: typeof window.fetch;
  let nativeXHR: typeof window.XMLHttpRequest;
  let nativeWebSocket: typeof window.WebSocket;

  beforeEach(() => {
    logSpy = vi.fn((entry: LogEntry) => {});
    nativeFetch = globalThis.fetch;
    nativeXHR = globalThis.XMLHttpRequest;
    nativeWebSocket = globalThis.WebSocket;
  });

  afterEach(() => {
    stopNetworkCapture();
    resetForTesting();
    globalThis.fetch = nativeFetch;
    globalThis.XMLHttpRequest = nativeXHR;
    globalThis.WebSocket = nativeWebSocket;
    vi.restoreAllMocks();
  });

  describe('fetch', () => {
    it('should capture a basic fetch request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve('ok'),
      } as unknown as Response);

      startNetworkCapture({ captureFetch: true, name: 'test-app' }, logSpy);

      await fetch('https://api.example.com/data', { method: 'POST' });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = logSpy.mock.calls[0][0] as LogEntry;
      
      expect(entry.msg).toBe('fetch POST https://api.example.com/data');
      expect(entry.level).toBe(30);
      expect(entry.name).toBe('test-app');
      expect(entry.source).toBe('network');
      
      expect(entry.network).toBeDefined();
      expect(entry.network?.type).toBe('fetch');
      expect(entry.network?.method).toBe('POST');
      expect(entry.network?.url).toBe('https://api.example.com/data');
      expect(entry.network?.status).toBe(200);
      expect(typeof entry.network?.duration).toBe('number');
    });

    it('should capture fetch errors as level 50', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      startNetworkCapture({ captureFetch: true }, logSpy);

      await expect(fetch('https://api.example.com/fail')).rejects.toThrow('Network failure');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = logSpy.mock.calls[0][0] as LogEntry;
      
      expect(entry.level).toBe(50);
      expect(entry.error?.message).toBe('Network failure');
    });

    it('should ignore URLs defined in ignoreNetworkUrls', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

      startNetworkCapture({
        captureFetch: true,
        ignoreNetworkUrls: ['/telemetry'],
      }, logSpy);

      await fetch('https://api.example.com/telemetry', { method: 'POST' });

      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('XMLHttpRequest', () => {
    it('should capture XHR requests', () => {
      // Mock the XHR prototype before starting capture
      class MockXHR extends EventTarget {
        status = 0;
        open(method: string, url: string) {}
        send(body?: any) {
          setTimeout(() => {
            this.status = 201;
            this.dispatchEvent(new Event('loadend'));
          }, 10);
        }
      }
      (globalThis as any).XMLHttpRequest = MockXHR;

      startNetworkCapture({ captureXhr: true }, logSpy);

      return new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.example.com/xhr-data');
        xhr.send();

        setTimeout(() => {
          expect(logSpy).toHaveBeenCalledTimes(1);
          const entry = logSpy.mock.calls[0][0] as LogEntry;
          expect(entry.msg).toBe('xhr GET https://api.example.com/xhr-data');
          expect(entry.network?.type).toBe('xhr');
          expect(entry.network?.status).toBe(201);
          resolve();
        }, 50);
      });
    });
  });

  describe('WebSocket', () => {
    it('should capture WebSocket connect and disconnect', () => {
      class MockWebSocket extends EventTarget {
        url: string;
        readyState = 1;
        constructor(url: string) {
          super();
          this.url = url;
          setTimeout(() => this.dispatchEvent(new Event('open')), 0);
        }
        send(data: any) {}
        close() {
          this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
        }
      }
      
      (globalThis as any).WebSocket = MockWebSocket;

      startNetworkCapture({ captureWebSockets: true }, logSpy);

      return new Promise<void>((resolve) => {
        const ws = new WebSocket('wss://chat.example.com');
        
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy.mock.calls[0][0].network?.event).toBe('connect');

        ws.close();

        setTimeout(() => {
          expect(logSpy).toHaveBeenCalledTimes(2);
          expect(logSpy.mock.calls[1][0].network?.event).toBe('disconnect');
          expect(logSpy.mock.calls[1][0].network?.status).toBe(1000);
          resolve();
        }, 50);
      });
    });
  });
});
