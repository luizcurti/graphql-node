import { PubSub, type PubSubEngine } from 'graphql-subscriptions';
import {
  RedisPubSub,
  type PubSubRedisOptions,
} from 'graphql-redis-subscriptions';
import Redis from 'ioredis';

// graphql-redis-subscriptions bundles its own (older, major v5) copy of
// ioredis, so its `RedisClient` type is nominally distinct from ours (v6)
// even though both are structurally compatible ioredis instances at runtime.
type RedisPubSubOptions = PubSubRedisOptions;

const createPubSub = (): PubSubEngine => {
  if (process.env.REDIS_URL) {
    const options = { lazyConnect: true };
    return new RedisPubSub({
      publisher: new Redis(
        process.env.REDIS_URL,
        options,
      ) as unknown as RedisPubSubOptions['publisher'],
      subscriber: new Redis(
        process.env.REDIS_URL,
        options,
      ) as unknown as RedisPubSubOptions['subscriber'],
    });
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'REDIS_URL is required in production for GraphQL subscriptions.',
    );
  }

  // Fallback in-memory — development/test only
  return new PubSub();
};

export const pubSub = createPubSub();
export const CREATED_COMMENT_TRIGGER = 'CREATED_COMMENT';
