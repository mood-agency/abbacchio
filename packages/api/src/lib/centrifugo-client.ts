/**
 * Centrifugo HTTP API Client
 * Publishes messages to Centrifugo server for real-time distribution
 */

const CENTRIFUGO_URL = process.env.CENTRIFUGO_URL || 'http://localhost:8000';
const CENTRIFUGO_API_KEY = process.env.CENTRIFUGO_API_KEY || '';

interface CentrifugoResponse {
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Publish a message to a single channel
 */
export async function publish(channel: string, data: unknown): Promise<void> {
  const response = await fetch(`${CENTRIFUGO_URL}/api/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CENTRIFUGO_API_KEY,
    },
    body: JSON.stringify({ channel, data }),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as CentrifugoResponse;
    throw new Error(
      `Centrifugo publish failed: ${error.error?.message || response.statusText}`
    );
  }
}

/**
 * Broadcast a message to multiple channels
 */
export async function broadcast(channels: string[], data: unknown): Promise<void> {
  const response = await fetch(`${CENTRIFUGO_URL}/api/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CENTRIFUGO_API_KEY,
    },
    body: JSON.stringify({ channels, data }),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as CentrifugoResponse;
    throw new Error(
      `Centrifugo broadcast failed: ${error.error?.message || response.statusText}`
    );
  }
}

/**
 * Check if Centrifugo is available
 */
export async function isAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${CENTRIFUGO_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
