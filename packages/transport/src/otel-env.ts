/**
 * Read the standard OpenTelemetry SDK environment variables, so that a program
 * using this transport can be pointed at a collector (or `abbacchio sandbox`)
 * and tagged with a version without code changes:
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT   base URL, e.g. http://localhost:4000
 *   OTEL_SERVICE_NAME             service.name (wins over OTEL_RESOURCE_ATTRIBUTES)
 *   OTEL_RESOURCE_ATTRIBUTES      key1=value1,key2=value2 (values may be %-encoded)
 *   OTEL_EXPORTER_OTLP_HEADERS    key1=value1,key2=value2
 *   OTEL_SDK_DISABLED             "true" disables sending
 *
 * Explicit client options always take precedence over these.
 * See https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/
 */

/** String key/value pairs, as used by OTEL_RESOURCE_ATTRIBUTES and OTEL_EXPORTER_OTLP_HEADERS. */
export type KeyValues = Record<string, string>;

export interface OtelEnvConfig {
  endpoint?: string;
  serviceName?: string;
  resourceAttributes: KeyValues;
  headers: KeyValues;
  disabled: boolean;
}

/** Environment lookup; a plain map so tests can pass their own. */
export type EnvSource = Record<string, string | undefined>;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse the `key=value,key=value` lists used by OTEL_RESOURCE_ATTRIBUTES and OTEL_EXPORTER_OTLP_HEADERS. */
export function parseKeyValueList(raw: string | undefined): KeyValues {
  const result: KeyValues = {};

  if (!raw) return result;

  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');

    if (eq <= 0) continue;

    const key = decode(pair.slice(0, eq).trim());
    const value = decode(pair.slice(eq + 1).trim());

    if (key) result[key] = value;
  }

  return result;
}

function processEnv(): EnvSource {
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

export function readOtelEnv(env: EnvSource = processEnv()): OtelEnvConfig {
  const resourceAttributes = parseKeyValueList(env.OTEL_RESOURCE_ATTRIBUTES);
  const serviceName = env.OTEL_SERVICE_NAME?.trim() || resourceAttributes['service.name'] || undefined;

  delete resourceAttributes['service.name'];

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim().replace(/\/+$/, '') || undefined;

  return {
    endpoint,
    serviceName,
    resourceAttributes,
    headers: parseKeyValueList(env.OTEL_EXPORTER_OTLP_HEADERS),
    disabled: env.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true',
  };
}
