import type { AbbacchioClient, SpanRecord } from './client.js';

export function getMemoryUsageBytes(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed;
  }
  if (typeof performance !== 'undefined' && (performance as any).memory) {
    return (performance as any).memory.usedJSHeapSize;
  }
  return 0;
}

function randomHex(bytes: number): string {
  let out = '';
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return out;
}

export interface TraceOptions {
  name: string;
  traceId?: string;
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Executes an operation, capturing execution time and memory delta.
 * Records the operation as an OTLP Span via the provided AbbacchioClient.
 */
export async function traceWithMemory<T>(
  client: AbbacchioClient,
  options: string | TraceOptions,
  operation: () => Promise<T> | T
): Promise<T> {
  const name = typeof options === 'string' ? options : options.name;
  const traceId = (typeof options !== 'string' && options.traceId) ? options.traceId : randomHex(16);
  const parentSpanId = typeof options !== 'string' ? options.parentSpanId : undefined;
  const baseAttributes = typeof options !== 'string' ? options.attributes : undefined;

  const startMemory = getMemoryUsageBytes();
  const startTime = Date.now();
  const startNano = BigInt(startTime) * 1_000_000n;

  let hasError = false;
  let errorMessage: string | undefined;

  try {
    return await operation();
  } catch (error) {
    hasError = true;
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const endMemory = getMemoryUsageBytes();
    const endTime = Date.now();
    const endNano = BigInt(endTime) * 1_000_000n;
    const durationMs = endTime - startTime;
    const memoryDelta = endMemory - startMemory;

    const span: SpanRecord = {
      traceId,
      spanId: randomHex(8),
      parentSpanId,
      name,
      kind: 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano: startNano.toString(),
      endTimeUnixNano: endNano.toString(),
      attributes: {
        ...baseAttributes,
        'duration.ms': durationMs,
        'memory.start_bytes': startMemory,
        'memory.end_bytes': endMemory,
        'memory.delta_bytes': memoryDelta,
        'memory.is_leak_suspect': memoryDelta > 50_000_000, // True if > 50MB
      },
      status: hasError ? { code: 2, message: errorMessage } : { code: 1 }
    };

    client.addSpan(span);
  }
}
