describe('logger', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('exposes the standard pino methods in development (pretty transport)', () => {
    process.env.NODE_ENV = 'development';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logger } = require('../utils/logger');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('exposes the standard pino methods in production (no transport)', () => {
    process.env.NODE_ENV = 'production';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logger } = require('../utils/logger');
    expect(typeof logger.info).toBe('function');
  });

  it('uses LOG_LEVEL from the environment when set', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'debug';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logger } = require('../utils/logger');
    expect(logger.level).toBe('debug');
  });
});

describe('traceMixin', () => {
  beforeEach(() => jest.resetModules());

  it('returns an empty object when there is no active span', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { traceMixin } = require('../utils/logger');
    expect(traceMixin()).toEqual({});
  });

  it('returns trace_id/span_id from the active span, when tracing is enabled', () => {
    jest.doMock('@opentelemetry/api', () => ({
      trace: {
        getActiveSpan: () => ({
          spanContext: () => ({ traceId: 'abc123', spanId: 'def456' }),
        }),
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { traceMixin } = require('../utils/logger');
    expect(traceMixin()).toEqual({ trace_id: 'abc123', span_id: 'def456' });
  });
});
