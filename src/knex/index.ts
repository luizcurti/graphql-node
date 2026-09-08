import knexFn, { type Knex } from 'knex';
import knexfile from './knexfile';

const env = process.env.NODE_ENV;
const envConfig = env ? knexfile[env] : undefined;
if (!env || !envConfig) {
  throw new Error(
    `Invalid or missing NODE_ENV: "${env}". Must be one of: ${Object.keys(
      knexfile,
    ).join(', ')}.`,
  );
}

export const knex = knexFn(envConfig);

// Optional read replica: point pure-read/list queries and DataLoader batch
// fetches at a secondary MySQL instance while writes (and the point reads
// that immediately follow a write, which need read-your-writes consistency)
// keep using `knex` above. Falls back to the primary connection — same
// additive-optional pattern as REDIS_URL/KAFKA_BROKERS elsewhere in this repo.
const replicaHost = process.env.DATABASE_REPLICA_HOST;

export const knexRead = replicaHost
  ? knexFn({
      ...envConfig,
      connection: {
        ...(envConfig.connection as Knex.MySql2ConnectionConfig),
        host: replicaHost,
        port: Number(
          process.env.DATABASE_REPLICA_PORT || process.env.DATABASE_PORT,
        ),
      },
    })
  : knex;
