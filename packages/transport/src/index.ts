// Core client
export { AbbacchioClient, createClient } from "./client.js";
export type { AbbacchioClientOptions, LogRecord, MetricRecord, HistogramRecord, SpanRecord } from "./client.js";

// Trace & Memory utilities
export { traceWithMemory, getMemoryUsageBytes } from "./trace.js";
export type { TraceOptions } from "./trace.js";

// Re-export transports for convenience
export { default as pinoTransport } from "./transports/pino.js";
export type { PinoTransportOptions } from "./transports/pino.js";

export { winstonTransport, AbbacchioWinstonTransport } from "./transports/winston.js";
export type { WinstonTransportOptions } from "./transports/winston.js";

export { bunyanStream, AbbacchioBunyanStream } from "./transports/bunyan.js";
export type { BunyanStreamOptions } from "./transports/bunyan.js";

export { createPinoStream } from "./transports/pino.js";
export type { AbbacchioPinoStream } from "./transports/pino.js";
