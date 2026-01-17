/**
 * Input Validation Middleware
 * Validates payload size, batch size, and individual log size
 */
import type { Context, Next, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ValidatorConfig {
  maxPayloadSize: number;   // Maximum payload size in bytes (default: 1MB)
  maxBatchSize: number;     // Maximum number of logs in a batch (default: 1000)
  maxSingleLogSize: number; // Maximum size of a single log entry in bytes (default: 64KB)
}

const DEFAULT_CONFIG: ValidatorConfig = {
  maxPayloadSize: parseInt(process.env.MAX_PAYLOAD_SIZE || '1048576', 10),    // 1MB
  maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '1000', 10),           // 1000 logs
  maxSingleLogSize: parseInt(process.env.MAX_SINGLE_LOG_SIZE || '65536', 10), // 64KB
};

/**
 * Validate incoming log payload
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * Validate a single log entry size
 */
export function validateLogEntry(log: unknown, maxSize: number): ValidationResult {
  const serialized = JSON.stringify(log);
  if (serialized.length > maxSize) {
    return {
      valid: false,
      error: `Log entry exceeds maximum size of ${maxSize} bytes (got ${serialized.length})`,
      statusCode: 413,
    };
  }
  return { valid: true };
}

/**
 * Validate batch request
 */
export function validateBatch(
  logs: unknown[],
  config: ValidatorConfig
): ValidationResult {
  if (!Array.isArray(logs)) {
    return {
      valid: false,
      error: 'logs must be an array',
      statusCode: 400,
    };
  }

  if (logs.length > config.maxBatchSize) {
    return {
      valid: false,
      error: `Batch size exceeds maximum of ${config.maxBatchSize} (got ${logs.length})`,
      statusCode: 413,
    };
  }

  // Validate each log entry
  for (let i = 0; i < logs.length; i++) {
    const result = validateLogEntry(logs[i], config.maxSingleLogSize);
    if (!result.valid) {
      return {
        valid: false,
        error: `Log entry at index ${i}: ${result.error}`,
        statusCode: result.statusCode,
      };
    }
  }

  return { valid: true };
}

/**
 * Create validation middleware for log ingestion
 */
export function createValidatorMiddleware(
  config: Partial<ValidatorConfig> = {}
): MiddlewareHandler {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return async (c: Context, next: Next) => {
    // Only validate POST requests to log endpoints
    if (c.req.method !== 'POST') {
      return next();
    }

    // Check Content-Length header if present
    const contentLength = c.req.header('content-length');
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      if (length > cfg.maxPayloadSize) {
        return c.json(
          {
            error: 'Payload Too Large',
            message: `Payload size ${length} exceeds maximum of ${cfg.maxPayloadSize} bytes`,
          },
          413
        );
      }
    }

    // Clone request to read body for validation
    // Note: This adds overhead but is necessary for validation
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: 'Invalid JSON', message: 'Request body must be valid JSON' },
        400
      );
    }

    // Validate total body size
    const bodyStr = JSON.stringify(body);
    if (bodyStr.length > cfg.maxPayloadSize) {
      return c.json(
        {
          error: 'Payload Too Large',
          message: `Payload size ${bodyStr.length} exceeds maximum of ${cfg.maxPayloadSize} bytes`,
        },
        413
      );
    }

    // Check if it's a batch request
    if (body && typeof body === 'object' && 'logs' in body) {
      const batchBody = body as { logs: unknown[] };
      const result = validateBatch(batchBody.logs, cfg);
      if (!result.valid) {
        const status = (result.statusCode || 400) as ContentfulStatusCode;
        return c.json(
          { error: status === 413 ? 'Payload Too Large' : 'Bad Request', message: result.error },
          status
        );
      }
    } else {
      // Single log validation
      const result = validateLogEntry(body, cfg.maxSingleLogSize);
      if (!result.valid) {
        const status = (result.statusCode || 413) as ContentfulStatusCode;
        return c.json(
          { error: 'Payload Too Large', message: result.error },
          status
        );
      }
    }

    // Store parsed body for handler to use (avoid re-parsing)
    c.set('validatedBody', body);

    await next();
  };
}

/**
 * Get validated body from context (set by validator middleware)
 */
export function getValidatedBody<T>(c: Context): T | null {
  return c.get('validatedBody') as T | null;
}

/**
 * Get default config (for testing)
 */
export function getDefaultValidatorConfig(): ValidatorConfig {
  return { ...DEFAULT_CONFIG };
}
