/**
 * Centrifugo Web Worker
 * Maintains WebSocket connection in background, unaffected by tab throttling
 */

import { Centrifuge, Subscription } from 'centrifuge';

// Message types from main thread to worker
interface ConnectMessage {
  type: 'connect';
  url: string;
  token: string;
}

interface SubscribeMessage {
  type: 'subscribe';
  channelId: string;
  channelName: string;
}

interface UnsubscribeMessage {
  type: 'unsubscribe';
  channelId: string;
}

interface RefreshTokenMessage {
  type: 'refresh-token';
  token: string;
}

interface DisconnectMessage {
  type: 'disconnect';
}

type WorkerIncomingMessage =
  | ConnectMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | RefreshTokenMessage
  | DisconnectMessage;

// Message types from worker to main thread
interface ConnectedMessage {
  type: 'connected';
}

interface DisconnectedMessage {
  type: 'disconnected';
  reason: string;
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

interface SubscribedMessage {
  type: 'subscribed';
  channelId: string;
}

interface SubscriptionErrorMessage {
  type: 'subscription-error';
  channelId: string;
  error: string;
}

interface PublicationMessage {
  type: 'publication';
  channelId: string;
  data: unknown;
}

interface TokenNeededMessage {
  type: 'token-needed';
}

type WorkerOutgoingMessage =
  | ConnectedMessage
  | DisconnectedMessage
  | ErrorMessage
  | SubscribedMessage
  | SubscriptionErrorMessage
  | PublicationMessage
  | TokenNeededMessage;

// Worker state
let centrifuge: Centrifuge | null = null;
const subscriptions = new Map<string, Subscription>();
const channelIdToName = new Map<string, string>();

// Post message to main thread with type safety
function postMessage(message: WorkerOutgoingMessage) {
  self.postMessage(message);
}

// Handle messages from main thread
self.onmessage = (event: MessageEvent<WorkerIncomingMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'connect':
      handleConnect(message);
      break;
    case 'subscribe':
      handleSubscribe(message);
      break;
    case 'unsubscribe':
      handleUnsubscribe(message);
      break;
    case 'refresh-token':
      handleRefreshToken(message);
      break;
    case 'disconnect':
      handleDisconnect();
      break;
  }
};

function handleConnect(message: ConnectMessage) {
  if (centrifuge) {
    centrifuge.disconnect();
  }

  centrifuge = new Centrifuge(message.url, {
    token: message.token,
    getToken: async () => {
      // Request token from main thread
      postMessage({ type: 'token-needed' });
      // Wait for token (will be provided via refresh-token message)
      return new Promise((resolve) => {
        const handler = (e: MessageEvent<WorkerIncomingMessage>) => {
          if (e.data.type === 'refresh-token') {
            self.removeEventListener('message', handler);
            resolve(e.data.token);
          }
        };
        self.addEventListener('message', handler);
      });
    },
  });

  centrifuge.on('connected', () => {
    postMessage({ type: 'connected' });
  });

  centrifuge.on('disconnected', (ctx) => {
    postMessage({ type: 'disconnected', reason: ctx.reason || 'Unknown' });
  });

  centrifuge.on('error', (ctx) => {
    postMessage({ type: 'error', error: ctx.error?.message || 'Unknown error' });
  });

  centrifuge.connect();
}

function handleSubscribe(message: SubscribeMessage) {
  if (!centrifuge) {
    postMessage({ type: 'subscription-error', channelId: message.channelId, error: 'Not connected' });
    return;
  }

  // Unsubscribe from existing subscription if any
  const existingSub = subscriptions.get(message.channelId);
  if (existingSub) {
    existingSub.unsubscribe();
    subscriptions.delete(message.channelId);
  }

  const centrifugoChannel = `logs:${message.channelName}`;
  channelIdToName.set(message.channelId, message.channelName);

  const sub = centrifuge.newSubscription(centrifugoChannel);

  sub.on('subscribed', () => {
    postMessage({ type: 'subscribed', channelId: message.channelId });
  });

  sub.on('publication', (ctx) => {
    postMessage({
      type: 'publication',
      channelId: message.channelId,
      data: ctx.data,
    });
  });

  sub.on('error', (ctx) => {
    postMessage({
      type: 'subscription-error',
      channelId: message.channelId,
      error: ctx.error?.message || 'Subscription error',
    });
  });

  sub.subscribe();
  subscriptions.set(message.channelId, sub);
}

function handleUnsubscribe(message: UnsubscribeMessage) {
  const sub = subscriptions.get(message.channelId);
  if (sub) {
    sub.unsubscribe();
    subscriptions.delete(message.channelId);
    channelIdToName.delete(message.channelId);
  }
}

function handleRefreshToken(_message: RefreshTokenMessage) {
  // Token refresh is handled by the getToken callback in handleConnect
  // This message is received to fulfill the promise
}

function handleDisconnect() {
  if (centrifuge) {
    // Unsubscribe from all channels
    for (const sub of subscriptions.values()) {
      sub.unsubscribe();
    }
    subscriptions.clear();
    channelIdToName.clear();

    centrifuge.disconnect();
    centrifuge = null;
  }
}

// Export types for use in main thread
export type { WorkerIncomingMessage, WorkerOutgoingMessage };
