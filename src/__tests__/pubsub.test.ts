describe('pubsub', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.REDIS_URL;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses RedisPubSub when REDIS_URL is defined', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.NODE_ENV = 'development';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pubSub, CREATED_COMMENT_TRIGGER } = require('../graphql/pubsub');
    expect(pubSub.constructor.name).toBe('RedisPubSub');
    expect(CREATED_COMMENT_TRIGGER).toBe('CREATED_COMMENT');
  });

  it('throws in production without REDIS_URL', () => {
    process.env.NODE_ENV = 'production';
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../graphql/pubsub');
    }).toThrow('REDIS_URL is required in production');
  });

  it('uses in-memory PubSub in development without REDIS_URL', () => {
    process.env.NODE_ENV = 'development';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pubSub } = require('../graphql/pubsub');
    expect(pubSub.constructor.name).toBe('PubSub');
  });
});
