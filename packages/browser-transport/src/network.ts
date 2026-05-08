/**
 * Network capture for Abbacchio (OTLP native)
 * Intercepts fetch, XMLHttpRequest, and WebSockets
 */

import type { LogEntry } from './client.js';

export interface NetworkCaptureOptions {
  /** Capture fetch requests. Defaults to false */
  captureFetch?: boolean;
  /** Capture XMLHttpRequest. Defaults to false */
  captureXhr?: boolean;
  /** Capture WebSockets. Defaults to false */
  captureWebSockets?: boolean;
  /** Ignore URLs for network capture */
  ignoreNetworkUrls?: (string | RegExp)[];
  /** Include request headers. Defaults to false */
  includeHeaders?: boolean;
  /** Include request/response bodies. Defaults to false */
  includeBody?: boolean;
  /** App name for log entries */
  name?: string;
  /** Include current URL in log entries. Defaults to true */
  includeUrl?: boolean;
  /** Include user agent in log entries. Defaults to false */
  includeUserAgent?: boolean;
}

let originalFetch: typeof window.fetch | null = null;
let originalXHR: typeof window.XMLHttpRequest | null = null;
let originalWebSocket: typeof window.WebSocket | null = null;

let isCapturing = false;
let options: NetworkCaptureOptions = {};
let logCallback: ((entry: LogEntry) => void) | null = null;

function shouldIgnore(url: string): boolean {
  if (!url || !options.ignoreNetworkUrls) return false;
  return options.ignoreNetworkUrls.some((pattern) => {
    if (typeof pattern === 'string') return url.includes(pattern);
    if (pattern instanceof RegExp) return pattern.test(url);
    return false;
  });
}

function createBaseEntry(action: string, level = 30): LogEntry {
  const entry: LogEntry = {
    level,
    time: Date.now(),
    name: options.name || 'browser',
    msg: action,
    source: 'network',
  };

  if (options.includeUrl !== false && typeof window !== 'undefined') {
    entry.url = window.location.href;
  }
  if (options.includeUserAgent && typeof navigator !== 'undefined') {
    entry.userAgent = navigator.userAgent;
  }
  return entry;
}

function patchFetch() {
  if (!originalFetch || typeof window === 'undefined') return;

  window.fetch = async function (...args: Parameters<typeof window.fetch>) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].href : args[0].url);
    
    if (shouldIgnore(url)) {
      return originalFetch.apply(this, args);
    }

    const method = (args[1]?.method || 'GET').toUpperCase();
    const entry = createBaseEntry(`fetch ${method} ${url}`);
    entry.network = { method, url, type: 'fetch' };
    
    if (options.includeBody && args[1]?.body) {
      entry.network.requestBody = args[1].body;
    }
    if (options.includeHeaders && args[1]?.headers) {
      entry.network.requestHeaders = args[1].headers;
    }

    const startTime = Date.now();
    try {
      const response = await originalFetch.apply(this, args);
      entry.network.status = response.status;
      entry.network.duration = Date.now() - startTime;
      entry.level = response.status >= 400 ? 40 : 30; // Warn on 4xx/5xx
      
      if (logCallback) logCallback(entry);
      return response;
    } catch (err) {
      entry.level = 50; // Error
      entry.network.duration = Date.now() - startTime;
      entry.error = err instanceof Error ? { message: err.message, name: err.name, stack: err.stack } : { message: String(err) };
      if (logCallback) logCallback(entry);
      throw err;
    }
  };
}

function patchXHR() {
  if (!originalXHR || typeof window === 'undefined') return;

  const originalOpen = originalXHR.prototype.open;
  const originalSend = originalXHR.prototype.send;

  window.XMLHttpRequest.prototype.open = function (...args: any[]) {
    const method = args[0];
    const url = args[1];
    
    if (!shouldIgnore(url)) {
      (this as any)._abbacchioXhr = { method, url, startTime: Date.now() };
    }
    
    return originalOpen.apply(this, args as any);
  };

  window.XMLHttpRequest.prototype.send = function (...args: any[]) {
    const reqData = (this as any)._abbacchioXhr;
    
    if (reqData) {
      const entry = createBaseEntry(`xhr ${reqData.method} ${reqData.url}`);
      entry.network = { method: reqData.method, url: reqData.url, type: 'xhr' };

      if (options.includeBody && args[0]) {
        entry.network.requestBody = args[0];
      }

      this.addEventListener('loadend', () => {
        entry.network!.status = this.status;
        entry.network!.duration = Date.now() - reqData.startTime;
        entry.level = this.status >= 400 ? 40 : 30;
        if (logCallback) logCallback(entry);
      });
    }
    return originalSend.apply(this, args as any);
  };
}

function patchWebSocket() {
  if (!originalWebSocket || typeof window === 'undefined') return;

  class AbbacchioWebSocket extends originalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      
      const wsUrl = url.toString();
      if (shouldIgnore(wsUrl)) return;

      const connectEntry = createBaseEntry(`websocket connect ${wsUrl}`);
      connectEntry.network = { url: wsUrl, type: 'websocket', event: 'connect' };
      if (logCallback) logCallback(connectEntry);

      this.addEventListener('close', (e) => {
        const closeEntry = createBaseEntry(`websocket disconnect ${wsUrl}`);
        closeEntry.network = { url: wsUrl, type: 'websocket', event: 'disconnect', status: e.code };
        if (logCallback) logCallback(closeEntry);
      });

      this.addEventListener('error', () => {
        const errEntry = createBaseEntry(`websocket error ${wsUrl}`, 50);
        errEntry.network = { url: wsUrl, type: 'websocket', event: 'error' };
        if (logCallback) logCallback(errEntry);
      });

      this.addEventListener('message', (e) => {
        const msgEntry = createBaseEntry(`websocket message in ${wsUrl}`);
        msgEntry.network = { url: wsUrl, type: 'websocket', event: 'message_in' };
        if (options.includeBody) msgEntry.network.payload = e.data;
        if (logCallback) logCallback(msgEntry);
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      const wsUrl = this.url;
      if (!shouldIgnore(wsUrl)) {
        const sendEntry = createBaseEntry(`websocket message out ${wsUrl}`);
        sendEntry.network = { url: wsUrl, type: 'websocket', event: 'message_out' };
        if (options.includeBody) sendEntry.network.payload = data;
        if (logCallback) logCallback(sendEntry);
      }
      super.send(data);
    }
  }

  (window as any).WebSocket = AbbacchioWebSocket;
}

export function startNetworkCapture(
  opts: NetworkCaptureOptions,
  onEntry: (entry: LogEntry) => void
): void {
  if (typeof window === 'undefined') return;

  if (!originalFetch) originalFetch = window.fetch;
  if (!originalXHR) originalXHR = window.XMLHttpRequest;
  if (!originalWebSocket) originalWebSocket = window.WebSocket;

  stopNetworkCapture();
  
  options = opts;
  logCallback = onEntry;
  isCapturing = true;

  if (opts.captureFetch && originalFetch) patchFetch();
  if (opts.captureXhr && originalXHR) patchXHR();
  if (opts.captureWebSockets && originalWebSocket) patchWebSocket();
}

export function stopNetworkCapture(): void {
  if (typeof window === 'undefined' || !isCapturing) return;

  if (originalFetch) window.fetch = originalFetch;
  if (originalXHR) window.XMLHttpRequest = originalXHR;
  if (originalWebSocket) window.WebSocket = originalWebSocket;

  isCapturing = false;
  logCallback = null;
  options = {};
}

export function resetForTesting() {
  originalFetch = null;
  originalXHR = null;
  originalWebSocket = null;
  isCapturing = false;
  options = {};
}
