import { pubSub, CREATED_COMMENT_TRIGGER } from '../graphql/pubsub';
import { logger } from '../utils/logger';
import { kafkaMessagesConsumedTotal } from '../observability/metrics';
import { getKafka } from './client';
import { COMMENT_CREATED_TOPIC } from './topics';

const kafka = getKafka();
const groupId =
  process.env.KAFKA_CONSUMER_GROUP || 'graphql-node-subscriptions';
const consumer = kafka?.consumer({ groupId }) ?? null;

// Consumes comment.created off Kafka and republishes onto the same PubSub
// the createdComment subscription already reads from — resolvers stay
// unaware of Kafka entirely.
export const startCommentConsumer = async (): Promise<void> => {
  if (!consumer) return;

  await consumer.connect();
  await consumer.subscribe({
    topic: COMMENT_CREATED_TOPIC,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      try {
        const event = JSON.parse(message.value.toString());
        await pubSub.publish(CREATED_COMMENT_TRIGGER, event);
        kafkaMessagesConsumedTotal.inc({
          topic: COMMENT_CREATED_TOPIC,
          status: 'success',
        });
      } catch (error) {
        logger.error(
          { err: (error as Error).message },
          'Failed to process Kafka message',
        );
        kafkaMessagesConsumedTotal.inc({
          topic: COMMENT_CREATED_TOPIC,
          status: 'error',
        });
      }
    },
  });

  logger.info(
    `Kafka consumer group "${groupId}" listening on "${COMMENT_CREATED_TOPIC}"`,
  );
};

export const stopCommentConsumer = async (): Promise<void> => {
  if (!consumer) return;
  await consumer.disconnect();
};
