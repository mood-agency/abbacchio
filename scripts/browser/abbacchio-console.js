/**
 * Abbacchio Console Capture
 *
 * Intercepts console.log, console.error, etc. and sends them to Abbacchio server.
 *
 * Usage:
 *   <script src="abbacchio-console.js"></script>
 *   <script>
 *     AbbacchioConsole.init({
 *       url: 'http://localhost:4000/api/logs',
 *       channel: 'my-app',
 *       appName: 'my-web-app',
 *       // secretKey: 'optional-encryption-key',
 *     });
 *   </script>
 */
(function(global) {
  'use strict';

  const config = {
    url: 'http://localhost:4000/api/logs',
    channel: 'browser-console',
    appName: 'web-app',
    secretKey: null,
    batchSize: 10,
    flushInterval: 1000,
    captureStackTrace: true,
    includeUrl: true,
    includeUserAgent: false,
  };

  let isCapturing = false;
  let buffer = [];
  let flushTimer = null;

  // Store original console methods
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  // Map console methods to log levels (Pino/Bunyan compatible)
  const levelMap = {
    debug: 20,
    log: 30,
    info: 30,
    warn: 40,
    error: 50,
  };

  // Encryption constants
  const ALGORITHM = 'AES-GCM';
  const IV_LENGTH = 16;
  const SALT_LENGTH = 32;
  const AUTH_TAG_LENGTH = 16;
  const PBKDF2_ITERATIONS = 100000;

  /**
   * Derive encryption key from password
   */
  async function deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: ALGORITHM, length: 256 },
      false,
      ['encrypt']
    );
  }

  /**
   * Encrypt data with AES-GCM
   */
  async function encrypt(data, secretKey) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(secretKey, salt);

    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv: iv },
      key,
      encoder.encode(data)
    );

    const encryptedArray = new Uint8Array(encrypted);
    const ciphertext = encryptedArray.slice(0, -AUTH_TAG_LENGTH);
    const authTag = encryptedArray.slice(-AUTH_TAG_LENGTH);

    const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + ciphertext.length);
    combined.set(salt, 0);
    combined.set(iv, SALT_LENGTH);
    combined.set(authTag, SALT_LENGTH + IV_LENGTH);
    combined.set(ciphertext, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Safely serialize a value for logging
   */
  function safeSerialize(value, seen = new WeakSet()) {
    if (value === null) return null;
    if (value === undefined) return undefined;

    if (typeof value === 'function') {
      return '[Function: ' + (value.name || 'anonymous') + ']';
    }

    if (typeof value !== 'object') {
      return value;
    }

    // Handle circular references
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    // Handle special objects
    if (value instanceof Error) {
      return {
        __type: 'Error',
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof RegExp) {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return value.map(item => safeSerialize(item, seen));
    }

    // Handle DOM elements
    if (value instanceof Element) {
      return '[Element: ' + value.tagName.toLowerCase() + (value.id ? '#' + value.id : '') + ']';
    }

    // Handle plain objects
    const result = {};
    for (const key of Object.keys(value)) {
      try {
        result[key] = safeSerialize(value[key], seen);
      } catch (e) {
        result[key] = '[Unserializable]';
      }
    }
    return result;
  }

  /**
   * Format console arguments into a message and data
   */
  function formatArgs(args) {
    const serialized = args.map(arg => safeSerialize(arg));

    // Build message string
    const msgParts = [];
    const dataObjects = [];

    for (const item of serialized) {
      if (typeof item === 'string') {
        msgParts.push(item);
      } else if (typeof item === 'number' || typeof item === 'boolean') {
        msgParts.push(String(item));
      } else if (item === null) {
        msgParts.push('null');
      } else if (item === undefined) {
        msgParts.push('undefined');
      } else {
        // It's an object
        dataObjects.push(item);
        msgParts.push(JSON.stringify(item));
      }
    }

    return {
      msg: msgParts.join(' '),
      data: dataObjects.length > 0 ? (dataObjects.length === 1 ? dataObjects[0] : dataObjects) : null,
    };
  }

  /**
   * Get caller location from stack trace
   */
  function getCallerLocation() {
    if (!config.captureStackTrace) return null;

    try {
      const stack = new Error().stack;
      if (!stack) return null;

      const lines = stack.split('\n');
      // Find the first line that's not from this file
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('abbacchio-console') ||
            line.includes('createInterceptor') ||
            line.includes('at console.') ||
            line.includes('at Object.') ||
            line.trim() === 'Error') {
          continue;
        }

        // Parse the location
        const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
        if (match) {
          return {
            function: match[1] || 'anonymous',
            file: match[2],
            line: parseInt(match[3], 10),
            column: parseInt(match[4], 10),
          };
        }
      }
    } catch (e) {
      // Ignore errors getting stack trace
    }
    return null;
  }

  /**
   * Create a log entry
   */
  function createLogEntry(level, args) {
    const { msg, data } = formatArgs(args);
    const location = getCallerLocation();

    const entry = {
      level: levelMap[level] || 30,
      time: Date.now(),
      name: config.appName,
      msg: msg,
    };

    if (config.includeUrl) {
      entry.url = window.location.href;
    }

    if (config.includeUserAgent) {
      entry.userAgent = navigator.userAgent;
    }

    if (location) {
      entry.caller = location;
    }

    if (data) {
      if (typeof data === 'object' && !Array.isArray(data)) {
        Object.assign(entry, data);
      } else {
        entry.data = data;
      }
    }

    return entry;
  }

  /**
   * Add log to buffer
   */
  function addToBuffer(entry) {
    buffer.push(entry);

    if (buffer.length >= config.batchSize) {
      flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(flush, config.flushInterval);
    }
  }

  /**
   * Flush buffer to server
   */
  async function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (buffer.length === 0) return;

    const toSend = buffer;
    buffer = [];

    try {
      let processedLogs = toSend;

      if (config.secretKey) {
        processedLogs = await Promise.all(
          toSend.map(async log => ({
            encrypted: await encrypt(JSON.stringify(log), config.secretKey)
          }))
        );
      }

      await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Encrypted': config.secretKey ? 'true' : 'false',
          'X-Channel': config.channel,
        },
        body: JSON.stringify({ logs: processedLogs }),
      });
    } catch (e) {
      // Silently fail - don't break the app
    }
  }

  /**
   * Create interceptor for a console method
   */
  function createInterceptor(method) {
    return function(...args) {
      // Always call original
      originalConsole[method](...args);

      // If capturing, send to Abbacchio
      if (isCapturing) {
        try {
          const entry = createLogEntry(method, args);
          addToBuffer(entry);
        } catch (e) {
          // Don't let logging errors break the app
        }
      }
    };
  }

  /**
   * Initialize and start capturing
   */
  function init(options = {}) {
    Object.assign(config, options);
    start();
  }

  /**
   * Start capturing
   */
  function start() {
    if (isCapturing) return;

    isCapturing = true;

    // Replace console methods
    console.log = createInterceptor('log');
    console.info = createInterceptor('info');
    console.warn = createInterceptor('warn');
    console.error = createInterceptor('error');
    console.debug = createInterceptor('debug');
  }

  /**
   * Stop capturing
   */
  function stop() {
    if (!isCapturing) return;

    isCapturing = false;

    // Restore original console methods
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;

    // Flush remaining logs
    flush();
  }

  /**
   * Update configuration
   */
  function configure(options) {
    Object.assign(config, options);
  }

  /**
   * Check if currently capturing
   */
  function isActive() {
    return isCapturing;
  }

  // Public API
  const AbbacchioConsole = {
    init,
    start,
    stop,
    configure,
    flush,
    isActive,
  };

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AbbacchioConsole;
  } else {
    global.AbbacchioConsole = AbbacchioConsole;
  }

})(typeof window !== 'undefined' ? window : this);
