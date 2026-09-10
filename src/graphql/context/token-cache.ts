import crypto from 'crypto';
import { getRedisClient } from '../../redis';
import { logger } from '../../utils/logger';

// Caches the (token -> userId) mapping context/index.ts's verifyJwtToken
// otherwise recomputes with a DB lookup on *every* request — a repeat
// request with the same still-valid token skips that lookup entirely.
// Keyed by a hash of the token, not the raw token, so a Redis dump/backup
// doesn't hand out live session tokens.
//
// Actively invalidated on login (a fresh token is issued) and logout (the
// token is cleared) — see LoginApi — rather than left to expire on its
// own, so token revocation isn't delayed by this TTL; the TTL is just a
// backstop for entries that are never explicitly invalidated (a crashed
// process, a DB row edited directly, etc).
//
// No-ops when REDIS_URL is unset — verifyJwtToken falls back to its
// existing DB-check-every-time behavior, same optional-additive pattern as
// everywhere else in this repo.
const TTL_SECONDS = 300;

const cacheKey = (token: string): string =>
  `jwt-cache:${crypto.createHash('sha256').update(token).digest('hex')}`;

export const getCachedUserId = async (
  token: string,
): Promise<string | null> => {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    return await redis.get(cacheKey(token));
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'JWT cache read failed — falling back to a DB check',
    );
    return null;
  }
};

export const cacheUserId = async (
  token: string,
  userId: string,
): Promise<void> => {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(cacheKey(token), userId, 'EX', TTL_SECONDS);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'JWT cache write failed — next request will just re-check the DB',
    );
  }
};

export const invalidateCachedToken = async (token: string): Promise<void> => {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.del(cacheKey(token));
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'Failed to invalidate JWT cache entry — it will still expire via TTL',
    );
  }
};
