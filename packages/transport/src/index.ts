// Core client
export { AbbacchioClient, createClient } from "./client.js";
export type { AbbacchioClientOptions } from "./client.js";

// Encryption utilities
export { generateKey, encrypt, decrypt, encryptLog, decryptLog } from "./encrypt.js";

// Re-export transports for convenience
export { default as pinoTransport } from "./transports/pino.js";
export type { PinoTransportOptions } from "./transports/pino.js";

export { winstonTransport, AbbacchioWinstonTransport } from "./transports/winston.js";
export type { WinstonTransportOptions } from "./transports/winston.js";

export { bunyanStream, AbbacchioBunyanStream } from "./transports/bunyan.js";
export type { BunyanStreamOptions } from "./transports/bunyan.js";

export { createPinoStream } from "./transports/pino.js";
export type { AbbacchioPinoStream } from "./transports/pino.js";
