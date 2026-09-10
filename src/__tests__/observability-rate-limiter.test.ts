describe('makeRateLimiter', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('happy path: returns a pass-through middleware when RATE_LIMIT_MAX is unset', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { makeRateLimiter } = require('../observability/rate-limiter');
    const middleware = makeRateLimiter();

    const next = jest.fn();
    middleware({} as any, {} as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('happy path: returns a pass-through middleware when RATE_LIMIT_MAX is 0', () => {
    process.env.RATE_LIMIT_MAX = '0';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { makeRateLimiter } = require('../observability/rate-limiter');
    const middleware = makeRateLimiter();

    const next = jest.fn();
    middleware({} as any, {} as any, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sad path (would reject over-limit traffic): builds a real express-rate-limit instance with the configured window/max when enabled', () => {
    process.env.RATE_LIMIT_MAX = '5';
    process.env.RATE_LIMIT_WINDOW_MS = '1000';

    const rateLimitMock = jest.fn(() => 'the-real-middleware');
    jest.doMock('express-rate-limit', () => ({
      __esModule: true,
      default: rateLimitMock,
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { makeRateLimiter } = require('../observability/rate-limiter');
    const middleware = makeRateLimiter();

    expect(rateLimitMock).toHaveBeenCalledWith({
      windowMs: 1000,
      limit: 5,
      standardHeaders: true,
      legacyHeaders: false,
    });
    expect(middleware).toBe('the-real-middleware');
  });

  it('falls back to a 60s window when RATE_LIMIT_WINDOW_MS is unset but the limiter is enabled', () => {
    process.env.RATE_LIMIT_MAX = '5';
    delete process.env.RATE_LIMIT_WINDOW_MS;

    const rateLimitMock = jest.fn(() => 'the-real-middleware');
    jest.doMock('express-rate-limit', () => ({
      __esModule: true,
      default: rateLimitMock,
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { makeRateLimiter } = require('../observability/rate-limiter');
    makeRateLimiter();

    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ windowMs: 60_000 }),
    );
  });
});
