import { pubSub, CREATED_COMMENT_TRIGGER } from '../graphql/pubsub';
import { logger } from '../utils/logger';
import { kafkaMessagesConsumedTotal } from '../observability/metrics';
import { getKafka } from './client';
import { COMMENT_CREATED_TOPIC } from './topics';

const kafka = getKafka();
const groupId =
  process.env.KAFKA_CONSUMER_GROUP || 'graphql-node-subscriptions';
const consumer = kafka?.consumer({ groupId }) ?? null;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// A freshly created topic isn't always visible to a consumer's very first
// subscribe() the instant a broker starts (auto-creation is async, and
// consumer.subscribe() doesn't retry UNKNOWN_TOPIC_OR_PARTITION itself even
// though KafkaJS marks it retriable) — verified directly against a cold,
// just-started single-broker Kafka container, where the first subscribe()
// reliably threw this before the topic existed yet. Retrying here, instead
// of letting it propagate, is what makes that a brief startup delay instead
// of a crash.
const subscribeWithRetry = async (
  attempts = [500, 1000, 2000, 4000, 8000],
): Promise<void> => {
  for (let i = 0; i <= attempts.length; i++) {
    try {
      await consumer!.subscribe({
        topic: COMMENT_CREATED_TOPIC,
        fromBeginning: false,
      });
      return;
    } catch (error) {
      if (i === attempts.length) throw error;
      logger.warn(
        { err: (error as Error).message, attempt: i + 1 },
        `Kafka subscribe failed, retrying in ${attempts[i]}ms`,
      );
      await sleep(attempts[i]);
    }
  }
};

// Consumes comment.created off Kafka and republishes onto the same PubSub
// the createdComment subscription already reads from — resolvers stay
// unaware of Kafka entirely.
//
// Failures here are logged, not thrown: Kafka is a documented optional
// add-on (see ../graphql/pubsub.ts), so a consumer that can't attach
// shouldn't take the whole GraphQL server down with it — the process
// previously crashed on startup this way against a cold broker (see
// subscribeWithRetry above), and Docker/Kubernetes' restart-on-crash policy
// was masking that as a silent extra restart rather than a real fix.
export const startCommentConsumer = async (): Promise<void> => {
  if (!consumer) return;

  try {
    await consumer.connect();
    await subscribeWithRetry();

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
  } catch (error) {
    logger.error(
      { err: (error as Error).message },
      'Kafka consumer failed to start — comment.created events via Kafka will not be delivered until this is resolved; the GraphQL server will continue starting regardless',
    );
  }
};

export const stopCommentConsumer = async (): Promise<void> => {
  if (!consumer) return;
  await consumer.disconnect();
};
