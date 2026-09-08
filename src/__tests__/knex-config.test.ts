jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('knexfile', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('builds the development and production config from env vars', () => {
    process.env.DATABASE_CLIENT = 'mysql2';
    process.env.DATABASE_HOST = 'db-host';
    process.env.DATABASE_PORT = '3306';
    process.env.DATABASE_NAME = 'mydb';
    process.env.DATABASE_USER = 'user';
    process.env.DATABASE_PASSWORD = 'pass';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../knex/knexfile').default;

    expect(config.development.client).toBe('mysql2');
    expect(config.development.connection).toEqual({
      host: 'db-host',
      port: 3306,
      database: 'mydb',
      user: 'user',
      password: 'pass',
      timezone: 'Z',
    });
    expect(config.production.client).toBe('mysql2');
    expect(config.development.migrations.tableName).toBe('knex_migrations');
    expect(config.development.seeds.directory).toContain('seeds');
  });

  it('uses mysql2 as the default client when DATABASE_CLIENT is not set', () => {
    delete process.env.DATABASE_CLIENT;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../knex/knexfile').default;
    expect(config.development.client).toBe('mysql2');
  });

  it('wires setUtcSessionTimezone as pool.afterCreate on every environment', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const knexfileModule = require('../knex/knexfile');
    expect(knexfileModule.default.development.pool.afterCreate).toBe(
      knexfileModule.setUtcSessionTimezone,
    );
    expect(knexfileModule.default.production.pool.afterCreate).toBe(
      knexfileModule.setUtcSessionTimezone,
    );
  });

  it('setUtcSessionTimezone forces the session to UTC on every new pooled connection', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setUtcSessionTimezone } = require('../knex/knexfile');
    const conn = {
      query: jest.fn((_sql: string, cb: (err: null) => void) => cb(null)),
    };
    const done = jest.fn();

    setUtcSessionTimezone(conn, done);

    expect(conn.query).toHaveBeenCalledWith(
      'SET time_zone = "+00:00"',
      expect.any(Function),
    );
    expect(done).toHaveBeenCalledWith(null, conn);
  });

  it('setUtcSessionTimezone propagates a query error to done()', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setUtcSessionTimezone } = require('../knex/knexfile');
    const queryError = new Error('connection reset');
    const conn = {
      query: jest.fn((_sql: string, cb: (err: Error) => void) =>
        cb(queryError),
      ),
    };
    const done = jest.fn();

    setUtcSessionTimezone(conn, done);

    expect(done).toHaveBeenCalledWith(queryError, conn);
  });
});

describe('knex/index', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws when NODE_ENV is missing', () => {
    delete process.env.NODE_ENV;
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../knex/index');
    }).toThrow(/Invalid or missing NODE_ENV/);
  });

  it('throws when NODE_ENV does not exist in the knexfile', () => {
    process.env.NODE_ENV = 'staging';
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../knex/index');
    }).toThrow(/Invalid or missing NODE_ENV/);
  });

  it('creates the knex instance with the correct environment config', () => {
    process.env.NODE_ENV = 'development';
    const fakeKnexInstance = { destroy: jest.fn() };
    const knexFnMock = jest.fn(() => fakeKnexInstance);

    jest.doMock('knex', () => ({ __esModule: true, default: knexFnMock }));
    jest.doMock('../knex/knexfile', () => ({
      __esModule: true,
      default: { development: { client: 'mysql2' } },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { knex } = require('../knex/index');

    expect(knexFnMock).toHaveBeenCalledWith({ client: 'mysql2' });
    expect(knex).toBe(fakeKnexInstance);
  });

  it('knexRead is the same instance as knex when DATABASE_REPLICA_HOST is unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DATABASE_REPLICA_HOST;
    const fakeKnexInstance = { destroy: jest.fn() };
    const knexFnMock = jest.fn(() => fakeKnexInstance);

    jest.doMock('knex', () => ({ __esModule: true, default: knexFnMock }));
    jest.doMock('../knex/knexfile', () => ({
      __esModule: true,
      default: {
        development: {
          client: 'mysql2',
          connection: { host: 'primary-host', port: 3306 },
        },
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { knex, knexRead } = require('../knex/index');

    expect(knexRead).toBe(knex);
    expect(knexFnMock).toHaveBeenCalledTimes(1);
  });

  it('builds a separate read-replica connection when DATABASE_REPLICA_HOST is set', () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_REPLICA_HOST = 'replica-host';
    process.env.DATABASE_PORT = '3306';
    process.env.DATABASE_REPLICA_PORT = '3307';
    const primaryInstance = { name: 'primary' };
    const replicaInstance = { name: 'replica' };
    const knexFnMock = jest
      .fn()
      .mockReturnValueOnce(primaryInstance)
      .mockReturnValueOnce(replicaInstance);

    jest.doMock('knex', () => ({ __esModule: true, default: knexFnMock }));
    jest.doMock('../knex/knexfile', () => ({
      __esModule: true,
      default: {
        development: {
          client: 'mysql2',
          connection: { host: 'primary-host', port: 3306 },
        },
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { knex, knexRead } = require('../knex/index');

    expect(knex).toBe(primaryInstance);
    expect(knexRead).toBe(replicaInstance);
    expect(knexFnMock).toHaveBeenCalledTimes(2);
    expect(knexFnMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        client: 'mysql2',
        connection: expect.objectContaining({
          host: 'replica-host',
          port: 3307,
        }),
      }),
    );
  });

  it('falls back to DATABASE_PORT for the replica when DATABASE_REPLICA_PORT is unset', () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_REPLICA_HOST = 'replica-host';
    process.env.DATABASE_PORT = '3306';
    delete process.env.DATABASE_REPLICA_PORT;
    const knexFnMock = jest.fn(() => ({}));

    jest.doMock('knex', () => ({ __esModule: true, default: knexFnMock }));
    jest.doMock('../knex/knexfile', () => ({
      __esModule: true,
      default: {
        development: {
          client: 'mysql2',
          connection: { host: 'primary-host', port: 3306 },
        },
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../knex/index');

    expect(knexFnMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ port: 3306 }),
      }),
    );
  });
});
