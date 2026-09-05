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
});
