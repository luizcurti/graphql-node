import type { Comment } from '../graphql/schema/comment/datasources';
import { pubSub, CREATED_COMMENT_TRIGGER } from '../graphql/pubsub';
import { logger } from '../utils/logger';
import { kafkaMessagesProducedTotal } from '../observability/metrics';
import { getKafka } from './client';
import { COMMENT_CREATED_TOPIC } from './topics';

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

export const publishCommentCreated = async (
  event: CommentCreatedEvent,
): Promise<void> => {
  if (!producer) {
    await pubSub.publish(CREATED_COMMENT_TRIGGER, event);
    return;
  }

  if (!connected) connected = producer.connect();
  await connected;

  await producer.send({
    topic: COMMENT_CREATED_TOPIC,
    messages: [{ value: JSON.stringify(event) }],
  });
  kafkaMessagesProducedTotal.inc({ topic: COMMENT_CREATED_TOPIC });
};

export const disconnectProducer = async (): Promise<void> => {
  if (!producer) return;
  await producer.disconnect();
};
