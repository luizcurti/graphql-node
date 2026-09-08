describe('redis client', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.REDIS_URL;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns null when REDIS_URL is not set', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getRedisClient } = require('../redis');
    expect(getRedisClient()).toBeNull();
  });

  it('returns a Redis instance when REDIS_URL is set', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getRedisClient } = require('../redis');
    expect(getRedisClient()).not.toBeNull();
  });

  it('memoizes the client across calls, including a first null result', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getRedisClient } = require('../redis');
    expect(getRedisClient()).toBeNull();

    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(getRedisClient()).toBeNull();
  });

  it('disconnectRedisClient is a no-op when no client was created', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { disconnectRedisClient } = require('../redis');
    await expect(disconnectRedisClient()).resolves.toBeUndefined();
  });

  it('disconnectRedisClient quits the client when one was created', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const quit = jest.fn().mockResolvedValue(undefined);
    jest.doMock('ioredis', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(() => ({ quit })),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getRedisClient, disconnectRedisClient } = require('../redis');
    getRedisClient();
    await disconnectRedisClient();

    expect(quit).toHaveBeenCalledTimes(1);
  });
});
