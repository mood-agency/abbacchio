/**
 * Centrifugo connection token endpoint
 * Generates JWT tokens for clients to connect to Centrifugo
 */

import type { Context } from 'hono';
import jwt from 'jsonwebtoken';

const TOKEN_SECRET = process.env.CENTRIFUGO_TOKEN_SECRET || '';
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * GET /api/centrifugo/token
 * Returns a JWT token for Centrifugo connection
 */
export function getConnectionToken(c: Context) {
  if (!TOKEN_SECRET) {
    console.error('[Centrifugo] TOKEN_SECRET not configured');
    return c.json({ error: 'Centrifugo not configured' }, 500);
  }

  const now = Math.floor(Date.now() / 1000);

  const token = jwt.sign(
    {
      sub: 'anonymous', // User ID - could be extracted from auth if needed
      iat: now,
      exp: now + TOKEN_EXPIRY_SECONDS,
    },
    TOKEN_SECRET,
    { algorithm: 'HS256' }
  );

  return c.json({ token });
}

/**
 * POST /api/centrifugo/refresh
 * Returns a new JWT token for token refresh
 */
export function refreshToken(c: Context) {
  if (!TOKEN_SECRET) {
    return c.json({ error: 'Centrifugo not configured' }, 500);
  }

  const now = Math.floor(Date.now() / 1000);

  const token = jwt.sign(
    {
      sub: 'anonymous',
      iat: now,
      exp: now + TOKEN_EXPIRY_SECONDS,
    },
    TOKEN_SECRET,
    { algorithm: 'HS256' }
  );

  return c.json({ token });
}
