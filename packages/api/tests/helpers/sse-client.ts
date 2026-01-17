import { createParser, type EventSourceMessage } from 'eventsource-parser';

export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Collect SSE events from a streaming response
 */
export async function collectSSEEvents(
  response: Response,
  options: { maxEvents?: number; timeout?: number } = {}
): Promise<SSEEvent[]> {
  const { maxEvents = 10, timeout = 3000 } = options;
  const events: SSEEvent[] = [];

  return new Promise(async (resolve) => {
    const timeoutId = setTimeout(() => {
      resolve(events);
    }, timeout);

    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        events.push({
          event: event.event || 'message',
          data: event.data,
          id: event.id,
        });

        if (events.length >= maxEvents) {
          clearTimeout(timeoutId);
          resolve(events);
        }
      },
    });

    const reader = response.body?.getReader();
    if (!reader) {
      clearTimeout(timeoutId);
      resolve(events);
      return;
    }

    try {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));

        // Check if we've collected enough events
        if (events.length >= maxEvents) {
          break;
        }
      }
    } catch {
      // Stream closed, resolve with collected events
    }

    clearTimeout(timeoutId);
    resolve(events);
  });
}

/**
 * Parse SSE event data as JSON
 */
export function parseEventData<T>(event: SSEEvent): T {
  return JSON.parse(event.data) as T;
}
