import type { Comment } from '../graphql/schema/comment/datasources';
import { pubSub, CREATED_COMMENT_TRIGGER } from '../graphql/pubsub';
import { logger } from '../utils/logger';
import { kafkaMessagesProducedTotal } from '../observability/metrics';
import { getKafka } from './client';
import { COMMENT_CREATED_TOPIC, COMMENT_CREATED_DLQ_TOPIC } from './topics';

export interface CommentCreatedEvent {
  createdComment: Comment;
  postOwner: string | null;
}

const kafka = getKafka();
const producer = kafka?.producer() ?? null;

if (!producer) {
  logger.info(
    'KAFKA_BROKERS not set — comment events publish directly to PubSub',
  );
}

let connected: Promise<void> | null = null;

// If connect() rejects, reset to null so the *next* call retries instead of
// replaying the same stale rejected promise forever — without this, one
// failed connection attempt permanently breaks Kafka publishing for the
// life of the process.
const ensureConnected = async (): Promise<void> => {
  if (!connected) {
    connected = producer!.connect().catch((err) => {
      connected = null;
      throw err;
    });
  }
  await connected;
};

export const publishCommentCreated = async (
  event: CommentCreatedEvent,
): Promise<void> => {
  if (!producer) {
    await pubSub.publish(CREATED_COMMENT_TRIGGER, event);
    return;
  }

  await ensureConnected();

  await producer.send({
    topic: COMMENT_CREATED_TOPIC,
    messages: [{ value: JSON.stringify(event) }],
  });
  kafkaMessagesProducedTotal.inc({ topic: COMMENT_CREATED_TOPIC });
};

// Republishes a message the consumer couldn't process (see ./consumer.ts)
// onto a separate DLQ topic instead of just logging and dropping it, so
// it's still inspectable/replayable. No-op when Kafka itself isn't
// configured — there's no DLQ to publish to and nothing else consumed the
// original message either.
export const publishToDeadLetterQueue = async (
  rawMessage: string,
  reason: string,
): Promise<void> => {
  if (!producer) return;

  await ensureConnected();

  await producer.send({
    topic: COMMENT_CREATED_DLQ_TOPIC,
    messages: [
      {
        value: JSON.stringify({
          originalTopic: COMMENT_CREATED_TOPIC,
          reason,
          payload: rawMessage,
          failedAt: new Date().toISOString(),
        }),
      },
    ],
  });
  kafkaMessagesProducedTotal.inc({ topic: COMMENT_CREATED_DLQ_TOPIC });
};

export const disconnectProducer = async (): Promise<void> => {
  if (!producer) return;
  await producer.disconnect();
};
