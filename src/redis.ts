import Redis from 'ioredis';

let client: Redis | null = null;
let attempted = false;

// General-purpose Redis client (login rate limiting today) — separate from
// the dedicated publisher/subscriber connections in graphql/pubsub.ts, since
// a connection in SUBSCRIBE mode can't run ordinary commands. Same
// optional-additive pattern as everywhere else: null when REDIS_URL is
// unset, so callers fall back to an in-process alternative.
export const getRedisClient = (): Redis | null => {
  if (attempted) return client;
  attempted = true;

  if (!process.env.REDIS_URL) return null;

  client = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    // Fail fast on an outage instead of piling up latency: without a cap,
    // ioredis queues and retries each command (default up to 20x) before
    // rejecting it. Login rate-limiting should degrade quickly to "unable to
    // check, let the request through" rather than hang the login request.
    maxRetriesPerRequest: 3,
  });
  return client;
};

export const disconnectRedisClient = async (): Promise<void> => {
  if (!client) return;
  await client.quit();
};
