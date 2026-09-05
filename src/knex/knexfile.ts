import { resolve } from 'path';
import dotenv from 'dotenv';
import type { Knex } from 'knex';

dotenv.config({
  path: resolve(__dirname, '..', '..', '.env'),
});

const sharedConfig: Omit<Knex.Config, 'migrations' | 'seeds'> = {
  client: process.env.DATABASE_CLIENT || 'mysql2',
  connection: {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    // Force UTC so TIMESTAMP literals are interpreted the same way regardless
    // of the host/container OS timezone (avoids DST-gap datetimes like
    // '2015-10-18 00:56:33' being rejected in America/Sao_Paulo).
    timezone: 'Z',
  },
  pool: {
    min: 2,
    max: 10,
    afterCreate: (
      conn: { query: (sql: string, cb: (err: Error | null) => void) => void },
      done: (err: Error | null, conn: unknown) => void,
    ) => {
      // The MySQL server's session time_zone otherwise follows the
      // container/host OS timezone (e.g. America/Sao_Paulo), which can
      // reject valid UTC instants that fall in a DST transition gap.
      conn.query('SET time_zone = "+00:00"', (err) => done(err, conn));
    },
  },
};

const config: Record<string, Knex.Config> = {
  development: {
    ...sharedConfig,
    migrations: {
      tableName: 'knex_migrations',
      directory: resolve(__dirname, 'migrations'),
    },
    seeds: {
      directory: resolve(__dirname, 'seeds'),
    },
  },
  production: {
    ...sharedConfig,
    migrations: {
      tableName: 'knex_migrations',
      directory: resolve(__dirname, 'migrations'),
    },
    seeds: {
      directory: resolve(__dirname, 'seeds'),
    },
  },
};

export default config;
