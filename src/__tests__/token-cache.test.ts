import crypto from 'crypto';

jest.mock('../redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../utils/logger', () => ({ logger: { warn: jest.fn() } }));

import { getRedisClient } from '../redis';
import { logger } from '../utils/logger';
import {
  getCachedUserId,
  cacheUserId,
  invalidateCachedToken,
} from '../graphql/context/token-cache';

const TOKEN = 'a-jwt-token';
const HASHED_KEY = `jwt-cache:${crypto.createHash('sha256').update(TOKEN).digest('hex')}`;

beforeEach(() => jest.clearAllMocks());

describe('getCachedUserId', () => {
  it('happy path: returns the cached userId', async () => {
    const redis = { get: jest.fn().mockResolvedValue('42') };
    (getRedisClient as jest.Mock).mockReturnValue(redis);

    await expect(getCachedUserId(TOKEN)).resolves.toBe('42');
    expect(redis.get).toHaveBeenCalledWith(HASHED_KEY);
  });

  it('happy path: returns null when Redis is not configured', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(null);

    await expect(getCachedUserId(TOKEN)).resolves.toBeNull();
  });

  it('sad path: returns null and logs a warning when Redis errors', async () => {
    const redis = {
      get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    (getRedisClient as jest.Mock).mockReturnValue(redis);

    await expect(getCachedUserId(TOKEN)).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: 'ECONNREFUSED' },
      expect.stringContaining('JWT cache read failed'),
    );
  });
});

describe('cacheUserId', () => {
  it('happy path: sets the mapping with a TTL', async () => {
    const redis = { set: jest.fn().mockResolvedValue('OK') };
    (getRedisClient as jest.Mock).mockReturnValue(redis);

    await cacheUserId(TOKEN, '42');

    expect(redis.set).toHaveBeenCalledWith(HASHED_KEY, '42', 'EX', 300);
  });

  it('happy path: no-ops when Redis is not configured', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(null);

    await expect(cacheUserId(TOKEN, '42')).resolves.toBeUndefined();
  });

  it('sad path: swallows the error and logs a warning when Redis errors', async () => {
    const redis = {
      set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    (getRedisClient as jest.Mock).mockReturnValue(redis);

    await expect(cacheUserId(TOKEN, '42')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: 'ECONNREFUSED' },
      expect.stringContaining('JWT cache write failed'),
    );
  });
});

describe('invalidateCachedToken', () => {
  it('happy path: deletes the cache entry', async () => {
    const redis = { del: jest.fn().mockResolvedValue(1) };
    (getRedisClient as jest.Mock).mockReturnValue(redis);

    await invalidateCachedToken(TOKEN);

    expect(redis.del).toHaveBeenCalledWith(HASHED_KEY);
  });

  it('happy path: no-ops when Redis is not configured', async () => {
    (getRedisClient as jest.Mock).mockReturnValue(null);

    await expect(invalidateCachedToken(TOKEN)).resolves.toBeUndefined();
  });

  it('sad path: swallows the error and logs a warning when Redis errors', async () => {
    const redis = {
      del: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    (getRedisClient as jest.Mock).mockReturnValue(redis);

    await expect(invalidateCachedToken(TOKEN)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: 'ECONNREFUSED' },
      expect.stringContaining('Failed to invalidate JWT cache entry'),
    );
  });
});
